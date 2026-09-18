import type { CnpjLookupLogger } from '@/infra/cnpj/receitaws-cnpj-lookup-provider';
import { ReceitaWsCnpjLookupProvider } from '@/infra/cnpj/receitaws-cnpj-lookup-provider';

/**
 * Testa o provider contra as formas de resposta reais da ReceitaWS, capturadas
 * do endpoint em produção. O `fetch` global é substituído por um dublê: nenhum
 * teste da suíte toca a rede (docs/09).
 *
 * Os dois casos que justificam este arquivo existir são os que a leitura
 * ingênua da API erraria: CNPJ inexistente vem como **HTTP 200** com
 * `status: "ERROR"`, e o limite de cota vem como **429 com corpo em texto
 * puro**, não JSON.
 */

const BASE_URL = 'https://receitaws.com.br/v1';
const CNPJ = '05557450000608';

function buildLogger(): CnpjLookupLogger {
  return { debug: jest.fn(), warn: jest.fn() };
}

function buildProvider(cacheTtlMs = 0, token?: string): ReceitaWsCnpjLookupProvider {
  return new ReceitaWsCnpjLookupProvider(
    { baseUrl: BASE_URL, timeoutMs: 5_000, cacheTtlMs, token },
    buildLogger(),
  );
}

/** Resposta de sucesso, com os campos que o provider consome. */
function okResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    status: 'OK',
    nome: "SAINT PAUL'S IMPORTACAO E EXPORTACAO LTDA",
    fantasia: '',
    situacao: 'ATIVA',
    ...overrides,
  });
}

describe('ReceitaWsCnpjLookupProvider', () => {
  // `Parameters<typeof fetch>` mantém o dublê com exatamente a assinatura do
  // `fetch` global, sem `as` para forçar o tipo (convenção do projeto) e sem
  // converter os argumentos para string.
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = (...args) => fetchMock(...args);
  });

  it('devolve FOUND com razão social e situação, normalizando fantasia vazia para null', async () => {
    fetchMock.mockResolvedValue(okResponse());

    const outcome = await buildProvider().lookup('05.557.450/0006-08');

    expect(outcome).toEqual({
      kind: 'FOUND',
      data: {
        cnpj: CNPJ,
        legalName: "SAINT PAUL'S IMPORTACAO E EXPORTACAO LTDA",
        tradeName: null,
        registrationStatus: 'ATIVA',
      },
    });
  });

  it('consulta a URL com o CNPJ somente em dígitos', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await buildProvider().lookup('05.557.450/0006-08');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/cnpj/${CNPJ}`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('preserva o nome fantasia quando a Receita devolve um', async () => {
    fetchMock.mockResolvedValue(okResponse({ fantasia: 'SAINT PAULS' }));

    const outcome = await buildProvider().lookup(CNPJ);

    expect(outcome).toMatchObject({ data: { tradeName: 'SAINT PAULS' } });
  });

  it('envia Authorization apenas quando há token configurado', async () => {
    fetchMock.mockResolvedValue(okResponse());
    await buildProvider(0, 'token-do-plano-comercial').lookup(CNPJ);

    const headers = fetchMock.mock.calls[0]?.[1]?.headers;
    expect(headers).toMatchObject({ Authorization: 'Bearer token-do-plano-comercial' });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(okResponse());
    await buildProvider().lookup(CNPJ);

    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('classifica como NOT_FOUND o HTTP 200 com status ERROR no corpo', async () => {
    // A ReceitaWS não usa 404 para CNPJ inexistente: responde 200 com
    // `status: "ERROR"`. Olhar só `response.ok` trataria isso como sucesso.
    fetchMock.mockResolvedValue(Response.json({ status: 'ERROR', message: 'CNPJ inválido' }));

    const outcome = await buildProvider().lookup(CNPJ);

    expect(outcome).toEqual({ kind: 'NOT_FOUND' });
  });

  it('classifica 429 com corpo em texto puro como RATE_LIMITED', async () => {
    // Limite do plano gratuito: 3 consultas/min por IP. O corpo é text/plain,
    // então o 429 é tratado antes de qualquer tentativa de parse JSON.
    fetchMock.mockResolvedValue(
      new Response('Too many requests, please try again later.', { status: 429 }),
    );

    const outcome = await buildProvider().lookup(CNPJ);

    expect(outcome).toEqual({ kind: 'RATE_LIMITED' });
  });

  it('classifica 5xx do provedor como UNAVAILABLE', async () => {
    fetchMock.mockResolvedValue(new Response('erro', { status: 502 }));

    const outcome = await buildProvider().lookup(CNPJ);

    expect(outcome).toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('classifica falha de rede/timeout como UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'));

    const outcome = await buildProvider().lookup(CNPJ);

    expect(outcome).toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('classifica corpo que não é JSON como UNAVAILABLE', async () => {
    fetchMock.mockResolvedValue(new Response('<html>manutenção</html>', { status: 200 }));

    const outcome = await buildProvider().lookup(CNPJ);

    expect(outcome).toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('classifica sucesso sem razão social como UNAVAILABLE', async () => {
    fetchMock.mockResolvedValue(okResponse({ nome: '' }));

    const outcome = await buildProvider().lookup(CNPJ);

    expect(outcome).toMatchObject({ kind: 'UNAVAILABLE' });
  });

  describe('cache', () => {
    it('reaproveita a resposta e não repete a chamada dentro do TTL', async () => {
      fetchMock.mockResolvedValue(okResponse());
      const provider = buildProvider(60_000);

      const first = await provider.lookup(CNPJ);
      const second = await provider.lookup('05.557.450/0006-08');

      expect(first).toEqual(second);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('não memoriza falhas transitórias', async () => {
      fetchMock.mockResolvedValue(
        new Response('Too many requests, please try again later.', { status: 429 }),
      );
      const provider = buildProvider(60_000);

      await provider.lookup(CNPJ);
      fetchMock.mockResolvedValue(okResponse());
      const retry = await provider.lookup(CNPJ);

      expect(retry).toMatchObject({ kind: 'FOUND' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('não usa cache quando o TTL é zero', async () => {
      fetchMock.mockResolvedValue(okResponse());
      const provider = buildProvider(0);

      await provider.lookup(CNPJ);
      await provider.lookup(CNPJ);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
