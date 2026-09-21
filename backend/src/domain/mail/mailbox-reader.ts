/**
 * Leitura da caixa de entrada pelo próprio backend (docs/13, decisão 9):
 * o agente de IA pede "o que chegou desde o cursor" e o corpo de cada
 * candidato à API, em vez de listar a caixa pelo conector — a listagem do
 * conector traz ~2 KB por e-mail (destinatários, prévia, links) e o corpo
 * vem em HTML com todo o histórico citado, o que estoura a memória de uma
 * execução em poucas páginas. Aqui a lista é enxuta e o corpo é texto
 * limpo. Mesma divisão de `MailAttachmentProvider`: interface no domínio,
 * implementação Microsoft Graph em `infra/graph/`.
 */

export interface MailboxSender {
  name: string | null;
  email: string | null;
}

export interface MailboxMessageSummary {
  /** Id da mensagem no provedor (Graph) — o `externalId` do intake. */
  id: string;
  internetMessageId: string | null;
  subject: string;
  from: MailboxSender;
  receivedAt: Date;
  hasAttachments: boolean;
  /** Prévia curta do corpo (o Graph limita a ~255 caracteres). */
  preview: string;
}

export interface MailboxAttachmentSummary {
  name: string;
  mimeType: string;
  size: number;
  isInline: boolean;
}

export interface MailboxMessageDetail extends MailboxMessageSummary {
  to: string[];
  cc: string[];
  /** Corpo em texto puro, como o provedor devolve (a limpeza é do service). */
  bodyText: string;
  attachments: MailboxAttachmentSummary[];
}

export interface ListMailboxOptions {
  /** Só mensagens recebidas depois deste instante (exclusivo). */
  after: Date;
  /** Máximo de mensagens (o provedor pode devolver menos). */
  limit: number;
}

export type ListMailboxOutcome =
  /** `hasMore` = ficou mensagem além de `limit`; a próxima chamada usa o `receivedAt` da última. */
  | { kind: 'OK'; messages: MailboxMessageSummary[]; hasMore: boolean }
  | { kind: 'UNAVAILABLE'; reason: string };

export type GetMailboxMessageOutcome =
  | { kind: 'OK'; message: MailboxMessageDetail }
  | { kind: 'MESSAGE_NOT_FOUND' }
  | { kind: 'UNAVAILABLE'; reason: string };

export interface MailboxReader {
  /** Caixa de entrada, do mais antigo para o mais novo a partir de `after`. */
  listMessages(options: ListMailboxOptions): Promise<ListMailboxOutcome>;
  getMessage(messageId: string): Promise<GetMailboxMessageOutcome>;
}
