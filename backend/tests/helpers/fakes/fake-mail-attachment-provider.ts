import type {
  ListAttachmentsOptions,
  MailAttachment,
  MailAttachmentProvider,
  MailAttachmentsOutcome,
} from '@/domain/mail/mail-attachment-provider';

/**
 * Dublê de `MailAttachmentProvider` (docs/09): nenhuma chamada ao Graph.
 * `outcome` é o que a próxima leitura devolve; `calls` registra os ids de
 * mensagem consultados e `optionsSeen` as opções (ex.: `internetMessageId`)
 * recebidas, para provar que o service repassa a chave secundária.
 */
export class FakeMailAttachmentProvider implements MailAttachmentProvider {
  readonly calls: string[] = [];
  readonly optionsSeen: ListAttachmentsOptions[] = [];
  outcome: MailAttachmentsOutcome = { kind: 'OK', attachments: [], messageId: 'fake' };

  async listAttachments(
    messageId: string,
    options: ListAttachmentsOptions = {},
  ): Promise<MailAttachmentsOutcome> {
    this.calls.push(messageId);
    this.optionsSeen.push(options);
    return this.outcome.kind === 'OK' ? { ...this.outcome, messageId } : this.outcome;
  }

  respondWith(
    attachments: Array<Partial<MailAttachment> & { name: string; content: Buffer }>,
  ): void {
    this.outcome = {
      kind: 'OK',
      messageId: 'fake',
      attachments: attachments.map((attachment, index) => ({
        id: attachment.id ?? `att-${index + 1}`,
        name: attachment.name,
        mimeType: attachment.mimeType ?? 'application/octet-stream',
        size: attachment.size ?? attachment.content.length,
        content: attachment.content,
        isInline: attachment.isInline ?? false,
      })),
    };
  }
}
