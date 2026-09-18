/**
 * Leitura dos anexos de uma mensagem de e-mail pelo próprio backend
 * (docs/13, decisão 3): o agente de IA passa só o id da mensagem; os bytes
 * nunca transitam pelo modelo. Vive no domínio pelo mesmo motivo de
 * `Mailer` e `StorageProvider`: `IntakeService` depende desta interface, a
 * implementação concreta (Microsoft Graph) fica em `infra/graph/`.
 */

export interface MailAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  content: Buffer;
  /** Imagem de assinatura/corpo HTML — normalmente não é documento do processo. */
  isInline: boolean;
}

export type MailAttachmentsOutcome =
  | { kind: 'OK'; attachments: MailAttachment[] }
  /** Id inexistente na caixa configurada (ou já excluído). */
  | { kind: 'MESSAGE_NOT_FOUND' }
  /** Falha de autenticação, rede, timeout ou 5xx do provedor. */
  | { kind: 'UNAVAILABLE'; reason: string };

export interface MailAttachmentProvider {
  /** `messageId` é o id da mensagem no provedor (Graph), como o conector de Outlook devolve. */
  listAttachments(messageId: string): Promise<MailAttachmentsOutcome>;
}
