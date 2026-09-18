import type {
  MailAttachment,
  MailAttachmentProvider,
  MailAttachmentsOutcome,
} from '@/domain/mail/mail-attachment-provider';

/** Forma mínima do logger do pino que este provider usa (mesma abordagem de `infra/cnpj`). */
export interface GraphLogger {
  debug(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface GraphMailAttachmentProviderConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Caixa lida pelo agente (UPN ou id). O id da mensagem só faz sentido dentro dela. */
  mailbox: string;
  timeoutMs: number;
  /** Bases sobrescritas apenas em teste (servidor local com Supertest/`fetch` real). */
  loginBaseUrl?: string | undefined;
  graphBaseUrl?: string | undefined;
}

/** Subconjunto de `fetch` que o provider usa — permite injetar um dublê no teste unitário. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface AttachmentListItem {
  '@odata.type'?: unknown;
  id?: unknown;
  name?: unknown;
  contentType?: unknown;
  size?: unknown;
  isInline?: unknown;
}

interface AttachmentListResponse {
  value?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Renova o token um pouco antes de expirar, para não usar um que morre no meio do download. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * Implementação de `MailAttachmentProvider` sobre o Microsoft Graph com
 * **credenciais de aplicação** (client credentials, docs/13, decisão 3 e
 * seção "Configuração"): a API lê os anexos direto da caixa da trading,
 * sem usuário logado, a partir do id da mensagem que o conector de Outlook
 * já devolveu ao agente.
 *
 * Duas decisões de implementação:
 *
 * 1. **Bytes via `/$value`, não via `contentBytes` da listagem.** A
 *    listagem `GET /messages/{id}/attachments` inclui `contentBytes` em
 *    base64 para anexos pequenos, mas omite para os grandes e infla a
 *    resposta em ~33%. Listar com `$select` leve e baixar cada arquivo
 *    por `/attachments/{id}/$value` funciona igual para qualquer tamanho.
 * 2. **Só `#microsoft.graph.fileAttachment`.** `itemAttachment` (e-mail
 *    anexado) e `referenceAttachment` (link OneDrive/SharePoint) não são
 *    arquivos e são ignorados com log em `debug`.
 *
 * Usa o `fetch` global do Node, como `ReceitaWsCnpjLookupProvider` — o
 * backend não tem cliente HTTP nas dependências e adicionar um SDK inteiro
 * do Graph para duas chamadas GET não se paga.
 */
export class GraphMailAttachmentProvider implements MailAttachmentProvider {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: GraphMailAttachmentProviderConfig,
    private readonly logger: GraphLogger,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async listAttachments(messageId: string): Promise<MailAttachmentsOutcome> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      this.logger.warn({ err: error }, 'Falha ao obter token do Microsoft Graph');
      return { kind: 'UNAVAILABLE', reason: 'Falha de autenticação no Microsoft Graph.' };
    }

    const base = `${this.graphBaseUrl()}/users/${encodeURIComponent(this.config.mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`;

    let listResponse: Response;
    try {
      listResponse = await this.fetchImpl(`${base}?$select=id,name,contentType,size,isInline`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      this.logger.warn({ err: error, messageId }, 'Falha de rede ao listar anexos no Graph');
      return { kind: 'UNAVAILABLE', reason: 'Falha de rede ao consultar o Microsoft Graph.' };
    }

    if (listResponse.status === 404) {
      return { kind: 'MESSAGE_NOT_FOUND' };
    }
    if (!listResponse.ok) {
      this.logger.warn(
        { status: listResponse.status, messageId },
        'Graph respondeu status inesperado ao listar anexos',
      );
      return {
        kind: 'UNAVAILABLE',
        reason: `Microsoft Graph respondeu HTTP ${listResponse.status}.`,
      };
    }

    let payload: unknown;
    try {
      payload = await listResponse.json();
    } catch (error) {
      this.logger.warn({ err: error, messageId }, 'Resposta do Graph não é JSON');
      return { kind: 'UNAVAILABLE', reason: 'Resposta do Microsoft Graph é inválida.' };
    }

    const items = this.parseList(payload);
    const attachments: MailAttachment[] = [];

    for (const item of items) {
      let contentResponse: Response;
      try {
        contentResponse = await this.fetchImpl(`${base}/${encodeURIComponent(item.id)}/$value`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch (error) {
        this.logger.warn({ err: error, messageId, attachmentId: item.id }, 'Falha ao baixar anexo');
        return { kind: 'UNAVAILABLE', reason: `Falha ao baixar o anexo ${item.name}.` };
      }
      if (!contentResponse.ok) {
        return {
          kind: 'UNAVAILABLE',
          reason: `Microsoft Graph respondeu HTTP ${contentResponse.status} ao baixar ${item.name}.`,
        };
      }
      const content = Buffer.from(await contentResponse.arrayBuffer());
      attachments.push({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        size: content.length,
        content,
        isInline: item.isInline,
      });
    }

    return { kind: 'OK', attachments };
  }

  private parseList(
    payload: unknown,
  ): Array<{ id: string; name: string; mimeType: string; isInline: boolean }> {
    if (!isRecord(payload)) return [];
    const list = (payload as AttachmentListResponse).value;
    if (!Array.isArray(list)) return [];

    const result: Array<{ id: string; name: string; mimeType: string; isInline: boolean }> = [];
    for (const raw of list) {
      if (!isRecord(raw)) continue;
      const item = raw as AttachmentListItem;
      if (item['@odata.type'] !== '#microsoft.graph.fileAttachment') {
        this.logger.debug({ type: item['@odata.type'] }, 'Anexo ignorado: não é arquivo');
        continue;
      }
      if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
      result.push({
        id: item.id,
        name: item.name,
        mimeType:
          typeof item.contentType === 'string' && item.contentType.length > 0
            ? item.contentType
            : 'application/octet-stream',
        isInline: item.isInline === true,
      });
    }
    return result;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
      return this.cachedToken.value;
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await this.fetchImpl(
      `${this.loginBaseUrl()}/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      },
    );

    if (!response.ok) {
      throw new Error(`Token endpoint respondeu HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as TokenResponse;
    if (typeof payload.access_token !== 'string') {
      throw new Error('Token endpoint não devolveu access_token.');
    }
    const expiresInSeconds = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;

    this.cachedToken = {
      value: payload.access_token,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    };
    return payload.access_token;
  }

  private loginBaseUrl(): string {
    return this.config.loginBaseUrl ?? 'https://login.microsoftonline.com';
  }

  private graphBaseUrl(): string {
    return this.config.graphBaseUrl ?? 'https://graph.microsoft.com/v1.0';
  }
}
