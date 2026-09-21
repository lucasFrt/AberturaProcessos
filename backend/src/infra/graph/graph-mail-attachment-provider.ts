import type {
  ListAttachmentsOptions,
  MailAttachment,
  MailAttachmentProvider,
  MailAttachmentsOutcome,
} from '@/domain/mail/mail-attachment-provider';
import type { CopyToFolderOutcome, MailboxOrganizer } from '@/domain/mail/mailbox-organizer';
import type {
  GetMailboxMessageOutcome,
  ListMailboxOptions,
  ListMailboxOutcome,
  MailboxAttachmentSummary,
  MailboxMessageDetail,
  MailboxMessageSummary,
  MailboxReader,
  MailboxSender,
} from '@/domain/mail/mailbox-reader';

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

interface GraphRecipient {
  emailAddress?: { name?: unknown; address?: unknown };
}

interface GraphMessage {
  id?: unknown;
  internetMessageId?: unknown;
  subject?: unknown;
  from?: GraphRecipient;
  toRecipients?: unknown;
  ccRecipients?: unknown;
  receivedDateTime?: unknown;
  hasAttachments?: unknown;
  bodyPreview?: unknown;
  body?: { contentType?: unknown; content?: unknown };
}

interface GraphMessageListResponse {
  value?: unknown;
  '@odata.nextLink'?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function senderOf(recipient: GraphRecipient | undefined): MailboxSender {
  const address = recipient?.emailAddress;
  return {
    name: typeof address?.name === 'string' && address.name.length > 0 ? address.name : null,
    email:
      typeof address?.address === 'string' && address.address.length > 0
        ? address.address.toLowerCase()
        : null,
  };
}

function addressesOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const result: string[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const address = (item as GraphRecipient).emailAddress?.address;
    if (typeof address === 'string' && address.length > 0) result.push(address.toLowerCase());
  }
  return result;
}

/** Campos comuns entre a listagem e o detalhe. `null` se faltar id ou data. */
function summaryOf(raw: unknown): MailboxMessageSummary | null {
  if (!isRecord(raw)) return null;
  const message = raw as GraphMessage;
  if (typeof message.id !== 'string' || message.id.length === 0) return null;
  const receivedAt =
    typeof message.receivedDateTime === 'string' ? new Date(message.receivedDateTime) : null;
  if (!receivedAt || Number.isNaN(receivedAt.getTime())) return null;
  return {
    id: message.id,
    internetMessageId:
      typeof message.internetMessageId === 'string' && message.internetMessageId.length > 0
        ? message.internetMessageId
        : null,
    subject: stringOr(message.subject, ''),
    from: senderOf(message.from),
    receivedAt,
    hasAttachments: message.hasAttachments === true,
    preview: stringOr(message.bodyPreview, ''),
  };
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
export class GraphMailAttachmentProvider
  implements MailAttachmentProvider, MailboxReader, MailboxOrganizer
{
  private cachedToken: { value: string; expiresAt: number } | null = null;
  /** Caminho de pasta (`a/b`) → id no Graph. As pastas não mudam de id; poupa duas chamadas por cópia. */
  private readonly folderIds = new Map<string, string>();

  constructor(
    private readonly config: GraphMailAttachmentProviderConfig,
    private readonly logger: GraphLogger,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async listAttachments(
    messageId: string,
    options: ListAttachmentsOptions = {},
  ): Promise<MailAttachmentsOutcome> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      this.logger.warn({ err: error }, 'Falha ao obter token do Microsoft Graph');
      return { kind: 'UNAVAILABLE', reason: 'Falha de autenticação no Microsoft Graph.' };
    }

    const outcome = await this.listAttachmentsById(messageId, token);
    if (outcome.kind !== 'MESSAGE_NOT_FOUND' || !options.internetMessageId) {
      return outcome;
    }

    // O id do Graph muda quando a mensagem é movida de pasta (docs/14); o
    // Message-ID RFC 5322 não. Procura na mesma caixa e tenta de novo.
    const resolved = await this.resolveByInternetMessageId(options.internetMessageId, token);
    if (resolved.kind !== 'FOUND') {
      return resolved.kind === 'NOT_FOUND'
        ? { kind: 'MESSAGE_NOT_FOUND' }
        : { kind: 'UNAVAILABLE', reason: resolved.reason };
    }
    this.logger.debug(
      { messageId, resolvedMessageId: resolved.messageId },
      'Mensagem localizada por internetMessageId',
    );
    return this.listAttachmentsById(resolved.messageId, token);
  }

  /**
   * Caixa de entrada a partir de `after`, mais antigos primeiro (docs/13,
   * decisão 9). `$select` enxuto de propósito: é a lista que o agente lê a
   * cada execução. `hasMore` vem da presença de `@odata.nextLink`.
   */
  async listMessages(options: ListMailboxOptions): Promise<ListMailboxOutcome> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      this.logger.warn({ err: error }, 'Falha ao obter token do Microsoft Graph');
      return { kind: 'UNAVAILABLE', reason: 'Falha de autenticação no Microsoft Graph.' };
    }

    const filter = `receivedDateTime gt ${options.after.toISOString()}`;
    const url =
      `${this.graphBaseUrl()}/users/${encodeURIComponent(this.config.mailbox)}/mailFolders/inbox/messages` +
      `?$filter=${encodeURIComponent(filter)}&$orderby=receivedDateTime%20asc&$top=${options.limit}` +
      `&$select=id,internetMessageId,subject,from,receivedDateTime,hasAttachments,bodyPreview`;

    const outcome = await this.getJson(url, token, 'listar a caixa de entrada');
    if (outcome.kind !== 'OK') {
      if (outcome.kind === 'NOT_FOUND') {
        return {
          kind: 'UNAVAILABLE',
          reason: 'Caixa de entrada não encontrada no Microsoft Graph.',
        };
      }
      if (outcome.kind === 'FORBIDDEN') {
        return {
          kind: 'UNAVAILABLE',
          reason: 'Sem permissão para ler a caixa no Microsoft Graph.',
        };
      }
      return outcome;
    }
    const payload = outcome.payload as GraphMessageListResponse;
    const list = Array.isArray(payload.value) ? payload.value : [];
    const messages: MailboxMessageSummary[] = [];
    for (const raw of list) {
      const summary = summaryOf(raw);
      if (summary) messages.push(summary);
    }
    return { kind: 'OK', messages, hasMore: typeof payload['@odata.nextLink'] === 'string' };
  }

  /** Detalhe com corpo em texto (`Prefer: outlook.body-content-type="text"`) e metadados dos anexos. */
  async getMessage(messageId: string): Promise<GetMailboxMessageOutcome> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      this.logger.warn({ err: error }, 'Falha ao obter token do Microsoft Graph');
      return { kind: 'UNAVAILABLE', reason: 'Falha de autenticação no Microsoft Graph.' };
    }

    const base = `${this.graphBaseUrl()}/users/${encodeURIComponent(this.config.mailbox)}/messages/${encodeURIComponent(messageId)}`;
    const messageOutcome = await this.getJson(
      `${base}?$select=id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,bodyPreview,body`,
      token,
      'ler a mensagem',
      { Prefer: 'outlook.body-content-type="text"' },
    );
    if (messageOutcome.kind !== 'OK') {
      if (messageOutcome.kind === 'NOT_FOUND') return { kind: 'MESSAGE_NOT_FOUND' };
      if (messageOutcome.kind === 'FORBIDDEN') {
        return {
          kind: 'UNAVAILABLE',
          reason: 'Sem permissão para ler a caixa no Microsoft Graph.',
        };
      }
      return messageOutcome;
    }
    const summary = summaryOf(messageOutcome.payload);
    if (!summary) {
      return { kind: 'UNAVAILABLE', reason: 'Resposta do Microsoft Graph é inválida.' };
    }
    const raw = messageOutcome.payload as GraphMessage;

    let attachments: MailboxAttachmentSummary[] = [];
    if (summary.hasAttachments) {
      const listOutcome = await this.getJson(
        `${base}/attachments?$select=id,name,contentType,size,isInline`,
        token,
        'listar anexos',
      );
      if (listOutcome.kind !== 'OK') {
        if (listOutcome.kind === 'NOT_FOUND') return { kind: 'MESSAGE_NOT_FOUND' };
        if (listOutcome.kind === 'FORBIDDEN') {
          return {
            kind: 'UNAVAILABLE',
            reason: 'Sem permissão para ler a caixa no Microsoft Graph.',
          };
        }
        return listOutcome;
      }
      attachments = this.parseList(listOutcome.payload).map((item) => ({
        name: item.name,
        mimeType: item.mimeType,
        size: item.size,
        isInline: item.isInline,
      }));
    }

    const detail: MailboxMessageDetail = {
      ...summary,
      to: addressesOf(raw.toRecipients),
      cc: addressesOf(raw.ccRecipients),
      bodyText: stringOr(raw.body?.content, ''),
      attachments,
    };
    return { kind: 'OK', message: detail };
  }

  /**
   * Copia a mensagem para `folderPath` (docs/13, decisão 12), criando as
   * pastas que faltarem. Exige `Application Mail.ReadWrite`: com `Mail.Read`
   * o Graph responde 403 → `FORBIDDEN`, e quem chamou decide (o intake só
   * avisa).
   */
  async copyMessageToFolder(messageId: string, folderPath: string[]): Promise<CopyToFolderOutcome> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      this.logger.warn({ err: error }, 'Falha ao obter token do Microsoft Graph');
      return { kind: 'UNAVAILABLE', reason: 'Falha de autenticação no Microsoft Graph.' };
    }

    const folder = await this.ensureFolder(folderPath, token);
    if (folder.kind !== 'OK') return folder;

    const copy = await this.postJson(
      `${this.mailboxUrl()}/messages/${encodeURIComponent(messageId)}/copy`,
      { destinationId: folder.id },
      token,
      'copiar a mensagem',
    );
    if (copy.kind !== 'OK') {
      return copy.kind === 'NOT_FOUND' ? { kind: 'MESSAGE_NOT_FOUND' } : copy;
    }
    const copied =
      isRecord(copy.payload) && typeof copy.payload.id === 'string' ? copy.payload.id : null;
    return { kind: 'OK', copiedMessageId: copied };
  }

  private async ensureFolder(
    folderPath: string[],
    token: string,
  ): Promise<
    { kind: 'OK'; id: string } | { kind: 'FORBIDDEN' } | { kind: 'UNAVAILABLE'; reason: string }
  > {
    let parentId: string | null = null;
    let key = '';
    for (const rawName of folderPath) {
      const name = rawName.trim();
      key = key ? `${key}/${name}` : name;
      const cached = this.folderIds.get(key);
      if (cached) {
        parentId = cached;
        continue;
      }
      const base = parentId
        ? `${this.mailboxUrl()}/mailFolders/${encodeURIComponent(parentId)}/childFolders`
        : `${this.mailboxUrl()}/mailFolders`;
      // OData: aspas simples no literal são escapadas duplicando-as.
      const literal = name.replace(/'/g, "''");
      const found = await this.getJson(
        `${base}?$filter=${encodeURIComponent(`displayName eq '${literal}'`)}&$select=id&$top=1`,
        token,
        'procurar a pasta',
      );
      if (found.kind === 'FORBIDDEN') return found;
      if (found.kind === 'UNAVAILABLE') return found;
      let id: string | null = null;
      if (found.kind === 'OK') {
        const list = isRecord(found.payload)
          ? (found.payload as { value?: unknown }).value
          : undefined;
        const first: unknown = Array.isArray(list) ? list[0] : undefined;
        if (isRecord(first) && typeof first.id === 'string') id = first.id;
      }
      if (!id) {
        const created = await this.postJson(base, { displayName: name }, token, 'criar a pasta');
        if (created.kind !== 'OK') {
          return created.kind === 'NOT_FOUND'
            ? { kind: 'UNAVAILABLE', reason: 'Pasta pai não encontrada no Microsoft Graph.' }
            : created;
        }
        if (!isRecord(created.payload) || typeof created.payload.id !== 'string') {
          return { kind: 'UNAVAILABLE', reason: 'Resposta do Microsoft Graph é inválida.' };
        }
        id = created.payload.id;
      }
      this.folderIds.set(key, id);
      parentId = id;
    }
    if (!parentId) return { kind: 'UNAVAILABLE', reason: 'Caminho de pasta vazio.' };
    return { kind: 'OK', id: parentId };
  }

  private async postJson(
    url: string,
    body: unknown,
    token: string,
    action: string,
  ): Promise<
    | { kind: 'OK'; payload: unknown }
    | { kind: 'NOT_FOUND' }
    | { kind: 'FORBIDDEN' }
    | { kind: 'UNAVAILABLE'; reason: string }
  > {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      this.logger.warn({ err: error }, `Falha de rede ao ${action} no Graph`);
      return { kind: 'UNAVAILABLE', reason: 'Falha de rede ao consultar o Microsoft Graph.' };
    }
    if (response.status === 403) return { kind: 'FORBIDDEN' };
    if (response.status === 404 || response.status === 400) return { kind: 'NOT_FOUND' };
    if (!response.ok) {
      this.logger.warn(
        { status: response.status },
        `Graph respondeu status inesperado ao ${action}`,
      );
      return { kind: 'UNAVAILABLE', reason: `Microsoft Graph respondeu HTTP ${response.status}.` };
    }
    try {
      return { kind: 'OK', payload: response.status === 204 ? null : await response.json() };
    } catch (error) {
      this.logger.warn({ err: error }, 'Resposta do Graph não é JSON');
      return { kind: 'UNAVAILABLE', reason: 'Resposta do Microsoft Graph é inválida.' };
    }
  }

  private mailboxUrl(): string {
    return `${this.graphBaseUrl()}/users/${encodeURIComponent(this.config.mailbox)}`;
  }

  /** GET JSON com a mesma classificação de erros de `listAttachmentsById`. */
  private async getJson(
    url: string,
    token: string,
    action: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<
    | { kind: 'OK'; payload: unknown }
    | { kind: 'NOT_FOUND' }
    | { kind: 'FORBIDDEN' }
    | { kind: 'UNAVAILABLE'; reason: string }
  > {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extraHeaders },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      this.logger.warn({ err: error }, `Falha de rede ao ${action} no Graph`);
      return { kind: 'UNAVAILABLE', reason: 'Falha de rede ao consultar o Microsoft Graph.' };
    }
    if (response.status === 403) {
      return { kind: 'FORBIDDEN' };
    }
    if (response.status === 404 || response.status === 400) {
      return { kind: 'NOT_FOUND' };
    }
    if (!response.ok) {
      this.logger.warn(
        { status: response.status },
        `Graph respondeu status inesperado ao ${action}`,
      );
      return { kind: 'UNAVAILABLE', reason: `Microsoft Graph respondeu HTTP ${response.status}.` };
    }
    try {
      return { kind: 'OK', payload: await response.json() };
    } catch (error) {
      this.logger.warn({ err: error }, 'Resposta do Graph não é JSON');
      return { kind: 'UNAVAILABLE', reason: 'Resposta do Microsoft Graph é inválida.' };
    }
  }

  private async resolveByInternetMessageId(
    internetMessageId: string,
    token: string,
  ): Promise<
    | { kind: 'FOUND'; messageId: string }
    | { kind: 'NOT_FOUND' }
    | { kind: 'UNAVAILABLE'; reason: string }
  > {
    // OData: aspas simples dentro do literal são escapadas duplicando-as.
    const literal = internetMessageId.replace(/'/g, "''");
    const url =
      `${this.graphBaseUrl()}/users/${encodeURIComponent(this.config.mailbox)}/messages` +
      `?$filter=${encodeURIComponent(`internetMessageId eq '${literal}'`)}&$select=id&$top=1`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Falha de rede ao procurar mensagem por internetMessageId');
      return { kind: 'UNAVAILABLE', reason: 'Falha de rede ao consultar o Microsoft Graph.' };
    }
    if (!response.ok) {
      return {
        kind: 'UNAVAILABLE',
        reason: `Microsoft Graph respondeu HTTP ${response.status} na busca por internetMessageId.`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { kind: 'UNAVAILABLE', reason: 'Resposta do Microsoft Graph é inválida.' };
    }
    const list = isRecord(payload) ? (payload as AttachmentListResponse).value : undefined;
    const first: unknown = Array.isArray(list) ? list[0] : undefined;
    if (isRecord(first) && typeof first.id === 'string' && first.id.length > 0) {
      return { kind: 'FOUND', messageId: first.id };
    }
    return { kind: 'NOT_FOUND' };
  }

  private async listAttachmentsById(
    messageId: string,
    token: string,
  ): Promise<MailAttachmentsOutcome> {
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

    // 404 = id bem formado que não existe mais nesta caixa (mensagem movida
    // de pasta). 400 = id malformado — verificado contra o Graph real: é o
    // que volta quando o agente manda a URI (`...%3D`) em vez do campo `id`.
    // Nos dois casos a mensagem não é alcançável por este id; com
    // `internetMessageId` ainda dá para reencontrá-la (docs/14).
    if (listResponse.status === 404 || listResponse.status === 400) {
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

    return { kind: 'OK', attachments, messageId };
  }

  private parseList(
    payload: unknown,
  ): Array<{ id: string; name: string; mimeType: string; size: number; isInline: boolean }> {
    if (!isRecord(payload)) return [];
    const list = (payload as AttachmentListResponse).value;
    if (!Array.isArray(list)) return [];

    const result: Array<{
      id: string;
      name: string;
      mimeType: string;
      size: number;
      isInline: boolean;
    }> = [];
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
        size: typeof item.size === 'number' ? item.size : 0,
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
