import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Cliente HTTP mínimo da API de abertura de processos, autenticado por
 * chave de API (docs/05, "Autenticação"; docs/13, decisão 2). Sem regra
 * de negócio: só traduz chamadas em requisições e devolve a resposta —
 * inclusive os erros — em uma forma que o modelo consegue ler e decidir
 * (ex.: 409 com candidatos).
 */

export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorEnvelope };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseErrorEnvelope(status: number, payload: unknown): ApiErrorEnvelope {
  if (isRecord(payload) && isRecord(payload.error)) {
    const error = payload.error;
    return {
      code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
      message: typeof error.message === 'string' ? error.message : `HTTP ${status}`,
      details: error.details,
      ...(typeof error.requestId === 'string' ? { requestId: error.requestId } : {}),
    };
  }
  return { code: 'UNKNOWN', message: `HTTP ${status}` };
}

export class ApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  async get<T>(
    route: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<ApiResult<T>> {
    const url = new URL(`${this.config.baseUrl}${route}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return this.request<T>(url.toString(), { method: 'GET' });
  }

  async postJson<T>(route: string, body: unknown): Promise<ApiResult<T>> {
    return this.request<T>(`${this.config.baseUrl}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async put<T>(route: string, body: unknown): Promise<ApiResult<T>> {
    return this.request<T>(`${this.config.baseUrl}${route}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /**
   * `multipart/form-data` com o JSON no campo `payload` e cada arquivo em
   * `files` (docs/05, "Intake"). Lê os arquivos do disco local — é o modo
   * para orquestradores cujo conector de e-mail salva anexos em pasta.
   */
  async postMultipart<T>(
    route: string,
    payload: unknown,
    filePaths: string[],
  ): Promise<ApiResult<T>> {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    for (const filePath of filePaths) {
      const content = await readFile(filePath);
      form.append('files', new Blob([content]), path.basename(filePath));
    }
    return this.request<T>(`${this.config.baseUrl}${route}`, { method: 'POST', body: form });
  }

  private async request<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
    const headers = new Headers(init.headers);
    headers.set('X-Api-Key', this.config.apiKey);
    headers.set('Accept', 'application/json');

    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (response.status === 204) {
      return { ok: true, status: 204, data: undefined as T };
    }

    let payload: unknown = null;
    const text = await response.text();
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: parseErrorEnvelope(response.status, payload),
      };
    }
    return { ok: true, status: response.status, data: payload as T };
  }
}
