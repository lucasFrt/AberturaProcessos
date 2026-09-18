import type {
  CnpjLookupOutcome,
  CnpjLookupProvider,
  CnpjRegistrationData,
} from '@/domain/cnpj/cnpj-lookup-provider';
import { normalizeCnpjDigits } from '@/shared/cnpj';

/**
 * Subconjunto do `Logger` do pino de que este provider precisa. Depender da
 * forma mínima (em vez do tipo completo do pino) permite injetar um dublê no
 * teste unitário sem recorrer a `as` para forçar o tipo — o `logger` real de
 * `infra/logger` satisfaz esta interface estruturalmente.
 */
export interface CnpjLookupLogger {
  debug(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface ReceitaWsCnpjLookupProviderConfig {
  /** Base da API, sem barra final. Ex.: `https://receitaws.com.br/v1`. */
  baseUrl: string;
  timeoutMs: number;
  /** TTL do cache em memória. `0` desliga o cache. */
  cacheTtlMs: number;
  /**
   * Token do plano comercial da ReceitaWS. Ausente no plano gratuito — a
   * chamada é feita sem `Authorization` nesse caso.
   */
  token?: string | undefined;
}

/**
 * Resposta da ReceitaWS, campos que consumimos. `status` é o discriminador do
 * próprio provedor: `"OK"` ou `"ERROR"` (com `message`), ambos servidos com
 * HTTP 200 — por isso não basta olhar `response.ok`.
 */
interface ReceitaWsPayload {
  status?: unknown;
  message?: unknown;
  nome?: unknown;
  fantasia?: unknown;
  situacao?: unknown;
}

function isRecord(value: unknown): value is ReceitaWsPayload {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface CacheEntry {
  outcome: CnpjLookupOutcome;
  expiresAt: number;
}

/**
 * Implementação de `CnpjLookupProvider` sobre a ReceitaWS
 * (`https://receitaws.com.br/v1/cnpj/<digitos>`), usando o `fetch` global do
 * Node — o backend não tem cliente HTTP nas dependências (ver
 * `backend/package.json`) e adicionar um só para uma chamada GET não se paga.
 *
 * Duas decisões que vêm do comportamento real da API, verificado contra o
 * endpoint em produção:
 *
 * 1. **`status` no corpo, não no HTTP.** Um CNPJ inexistente volta como
 *    HTTP 200 com `{"status":"ERROR","message":...}`. Confiar apenas em
 *    `response.ok` classificaria isso como sucesso.
 * 2. **429 com corpo em texto puro.** O limite do plano gratuito (3
 *    consultas por minuto por IP) responde `Too many requests, please try
 *    again later.` como `text/plain`, não JSON — daí o 429 ser tratado antes
 *    de qualquer tentativa de `json()`.
 *
 * O cache em memória existe por causa desse limite de 3/min: sem ele, o
 * operador que corrige um dígito e refaz a consulta duas vezes já esgota a
 * cota. Só respostas estáveis (`FOUND`/`NOT_FOUND`) são memorizadas; falhas
 * transitórias não, para não congelar uma indisponibilidade momentânea.
 */
export class ReceitaWsCnpjLookupProvider implements CnpjLookupProvider {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly config: ReceitaWsCnpjLookupProviderConfig,
    private readonly logger: CnpjLookupLogger,
  ) {}

  async lookup(cnpj: string): Promise<CnpjLookupOutcome> {
    const digits = normalizeCnpjDigits(cnpj);

    const cached = this.readFromCache(digits);
    if (cached) return cached;

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/cnpj/${digits}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      // Timeout (`TimeoutError` do AbortSignal) e falha de DNS/conexão caem
      // aqui. Log em `warn`: é falha de terceiro, não erro da aplicação.
      this.logger.warn({ err: error, cnpj: digits }, 'Consulta de CNPJ falhou');
      return { kind: 'UNAVAILABLE', reason: 'Falha de rede ao consultar a Receita Federal.' };
    }

    if (response.status === 429) {
      return { kind: 'RATE_LIMITED' };
    }

    if (!response.ok) {
      this.logger.warn(
        { status: response.status, cnpj: digits },
        'Consulta de CNPJ retornou status inesperado',
      );
      return {
        kind: 'UNAVAILABLE',
        reason: `Provedor de consulta respondeu HTTP ${response.status}.`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      this.logger.warn({ err: error, cnpj: digits }, 'Resposta de consulta de CNPJ não é JSON');
      return { kind: 'UNAVAILABLE', reason: 'Resposta do provedor de consulta é inválida.' };
    }

    return this.writeToCache(digits, this.interpret(digits, payload));
  }

  private interpret(digits: string, payload: unknown): CnpjLookupOutcome {
    if (!isRecord(payload)) {
      return { kind: 'UNAVAILABLE', reason: 'Resposta do provedor de consulta é inválida.' };
    }

    if (payload.status !== 'OK') {
      // A ReceitaWS usa `status: "ERROR"` tanto para CNPJ inexistente quanto
      // para CNPJ malformado. Os dígitos verificadores já foram validados
      // pelo service antes de chegar aqui, então o caso remanescente é
      // "não existe na base".
      this.logger.debug(
        { cnpj: digits, message: payload.message },
        'Consulta de CNPJ sem resultado',
      );
      return { kind: 'NOT_FOUND' };
    }

    const legalName = optionalString(payload.nome);
    if (!legalName) {
      return {
        kind: 'UNAVAILABLE',
        reason: 'Provedor de consulta não devolveu a razão social.',
      };
    }

    const data: CnpjRegistrationData = {
      cnpj: digits,
      legalName,
      tradeName: optionalString(payload.fantasia),
      registrationStatus: optionalString(payload.situacao),
    };
    return { kind: 'FOUND', data };
  }

  private readFromCache(digits: string): CnpjLookupOutcome | null {
    if (this.config.cacheTtlMs <= 0) return null;

    const entry = this.cache.get(digits);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(digits);
      return null;
    }
    return entry.outcome;
  }

  private writeToCache(digits: string, outcome: CnpjLookupOutcome): CnpjLookupOutcome {
    const isStable = outcome.kind === 'FOUND' || outcome.kind === 'NOT_FOUND';
    if (this.config.cacheTtlMs > 0 && isStable) {
      this.cache.set(digits, { outcome, expiresAt: Date.now() + this.config.cacheTtlMs });
    }
    return outcome;
  }
}
