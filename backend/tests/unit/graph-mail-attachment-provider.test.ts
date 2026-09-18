import type { FetchLike } from '@/infra/graph/graph-mail-attachment-provider';
import { GraphMailAttachmentProvider } from '@/infra/graph/graph-mail-attachment-provider';

/**
 * Cobre `GraphMailAttachmentProvider` sem rede (docs/09): `fetch` é
 * injetado e responde por rota. Prova o token em cache, a filtragem por
 * tipo de anexo, o download por `/$value` e a classificação de erros.
 */

const silentLogger = { debug: (): void => undefined, warn: (): void => undefined };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildProvider(
  routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>,
): {
  provider: GraphMailAttachmentProvider;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push(input);
    const match = Object.entries(routes).find(([prefix]) => input.startsWith(prefix));
    if (!match) throw new Error(`Rota não simulada: ${input}`);
    return match[1](init);
  };
  const provider = new GraphMailAttachmentProvider(
    {
      tenantId: 'tenant',
      clientId: 'client',
      clientSecret: 'secret',
      mailbox: 'processos@opusce.com.br',
      timeoutMs: 1000,
      loginBaseUrl: 'https://login.test',
      graphBaseUrl: 'https://graph.test/v1.0',
    },
    silentLogger,
    fetchImpl,
  );
  return { provider, calls };
}

const TOKEN_URL = 'https://login.test/tenant/oauth2/v2.0/token';
const ATTACHMENTS_URL =
  'https://graph.test/v1.0/users/processos%40opusce.com.br/messages/msg-1/attachments';

describe('GraphMailAttachmentProvider', () => {
  it('obtém token por client credentials, lista só fileAttachment e baixa cada um por /$value', async () => {
    const { provider, calls } = buildProvider({
      [TOKEN_URL]: (init) => {
        const body = typeof init?.body === 'string' ? init.body : '';
        expect(body).toContain('grant_type=client_credentials');
        expect(body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
        return jsonResponse({ access_token: 'tok', expires_in: 3600 });
      },
      [`${ATTACHMENTS_URL}/att-1/$value`]: () => new Response(Buffer.from('PDF-BYTES')),
      [`${ATTACHMENTS_URL}?`]: (init) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
        return jsonResponse({
          value: [
            {
              '@odata.type': '#microsoft.graph.fileAttachment',
              id: 'att-1',
              name: 'invoice.pdf',
              contentType: 'application/pdf',
              size: 9,
              isInline: false,
            },
            { '@odata.type': '#microsoft.graph.itemAttachment', id: 'att-2', name: 'Fwd: x' },
          ],
        });
      },
    });

    const outcome = await provider.listAttachments('msg-1');

    expect(outcome.kind).toBe('OK');
    if (outcome.kind !== 'OK') return;
    expect(outcome.attachments).toHaveLength(1);
    expect(outcome.attachments[0]?.name).toBe('invoice.pdf');
    expect(outcome.attachments[0]?.content.toString()).toBe('PDF-BYTES');
    expect(outcome.attachments[0]?.size).toBe(9);
    expect(calls.filter((url) => url === TOKEN_URL)).toHaveLength(1);
  });

  it('reutiliza o token em cache na segunda chamada', async () => {
    const { provider, calls } = buildProvider({
      [TOKEN_URL]: () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      [`${ATTACHMENTS_URL}?`]: () => jsonResponse({ value: [] }),
    });

    await provider.listAttachments('msg-1');
    await provider.listAttachments('msg-1');

    expect(calls.filter((url) => url === TOKEN_URL)).toHaveLength(1);
  });

  it('404 na listagem vira MESSAGE_NOT_FOUND', async () => {
    const { provider } = buildProvider({
      [TOKEN_URL]: () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      [`${ATTACHMENTS_URL}?`]: () => new Response('', { status: 404 }),
    });

    expect(await provider.listAttachments('msg-1')).toEqual({ kind: 'MESSAGE_NOT_FOUND' });
  });

  it('falha de token vira UNAVAILABLE sem propagar exceção', async () => {
    const { provider } = buildProvider({
      [TOKEN_URL]: () => new Response('nope', { status: 401 }),
    });

    const outcome = await provider.listAttachments('msg-1');

    expect(outcome.kind).toBe('UNAVAILABLE');
  });

  it('5xx na listagem e falha no download viram UNAVAILABLE', async () => {
    const { provider: listFails } = buildProvider({
      [TOKEN_URL]: () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      [`${ATTACHMENTS_URL}?`]: () => new Response('', { status: 503 }),
    });
    expect((await listFails.listAttachments('msg-1')).kind).toBe('UNAVAILABLE');

    const { provider: downloadFails } = buildProvider({
      [TOKEN_URL]: () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      [`${ATTACHMENTS_URL}/att-1/$value`]: () => {
        throw new Error('rede caiu');
      },
      [`${ATTACHMENTS_URL}?`]: () =>
        jsonResponse({
          value: [{ '@odata.type': '#microsoft.graph.fileAttachment', id: 'att-1', name: 'a.pdf' }],
        }),
    });
    expect((await downloadFails.listAttachments('msg-1')).kind).toBe('UNAVAILABLE');
  });

  it('404 pelo id com internetMessageId informado: resolve por $filter e tenta de novo (docs/14)', async () => {
    const MESSAGES_URL = 'https://graph.test/v1.0/users/processos%40opusce.com.br/messages';
    const NEW_ATTACHMENTS_URL = `${MESSAGES_URL}/id-novo/attachments`;
    const { provider, calls } = buildProvider({
      [TOKEN_URL]: () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      [`${ATTACHMENTS_URL}?`]: () => new Response('', { status: 404 }),
      [`${MESSAGES_URL}?$filter=`]: () => jsonResponse({ value: [{ id: 'id-novo' }] }),
      [`${NEW_ATTACHMENTS_URL}/att-1/$value`]: () => new Response(Buffer.from('novo')),
      [`${NEW_ATTACHMENTS_URL}?`]: () =>
        jsonResponse({
          value: [
            { '@odata.type': '#microsoft.graph.fileAttachment', id: 'att-1', name: 'bl.pdf' },
          ],
        }),
    });

    const outcome = await provider.listAttachments('msg-1', {
      internetMessageId: "<a'b@mail.example>",
    });

    expect(outcome.kind).toBe('OK');
    if (outcome.kind !== 'OK') return;
    expect(outcome.messageId).toBe('id-novo');
    expect(outcome.attachments[0]?.content.toString()).toBe('novo');
    // Aspas simples do Message-ID escapadas em dobro no literal OData.
    const filterCall = calls.find((url) => url.includes('$filter='));
    expect(filterCall).toContain(encodeURIComponent("internetMessageId eq '<a''b@mail.example>'"));
  });

  it('404 pelo id sem internetMessageId (ou sem resultado no $filter) continua MESSAGE_NOT_FOUND', async () => {
    const MESSAGES_URL = 'https://graph.test/v1.0/users/processos%40opusce.com.br/messages';
    const { provider } = buildProvider({
      [TOKEN_URL]: () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      [`${ATTACHMENTS_URL}?`]: () => new Response('', { status: 404 }),
      [`${MESSAGES_URL}?$filter=`]: () => jsonResponse({ value: [] }),
    });

    expect(await provider.listAttachments('msg-1')).toEqual({ kind: 'MESSAGE_NOT_FOUND' });
    expect(
      await provider.listAttachments('msg-1', { internetMessageId: '<nada@mail.example>' }),
    ).toEqual({ kind: 'MESSAGE_NOT_FOUND' });
  });

  it('anexo sem contentType recebe application/octet-stream', async () => {
    const { provider } = buildProvider({
      [TOKEN_URL]: () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      [`${ATTACHMENTS_URL}/att-1/$value`]: () => new Response(Buffer.from('x')),
      [`${ATTACHMENTS_URL}?`]: () =>
        jsonResponse({
          value: [
            { '@odata.type': '#microsoft.graph.fileAttachment', id: 'att-1', name: 'sem-tipo' },
          ],
        }),
    });

    const outcome = await provider.listAttachments('msg-1');

    if (outcome.kind !== 'OK') throw new Error('esperado OK');
    expect(outcome.attachments[0]?.mimeType).toBe('application/octet-stream');
  });
});
