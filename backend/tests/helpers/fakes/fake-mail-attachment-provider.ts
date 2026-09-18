import type {
  MailAttachment,
  MailAttachmentProvider,
  MailAttachmentsOutcome,
} from '@/domain/mail/mail-attachment-provider';

/**
 * Dublê de `MailAttachmentProvider` (docs/09): nenhuma chamada ao Graph.
 * `outcome` é o que a próxima leitura devolve; `calls` registra os ids de
 * mensagem consultados.
 */
export class FakeMailAttachmentProvider implements MailAttachmentProvider {
  readonly calls: string[] = [];
  outcome: MailAttachmentsOutcome = { kind: 'OK', attachments: [] };

  async listAttachments(messageId: string): Promise<MailAttachmentsOutcome> {
    this.calls.push(messageId);
    return this.outcome;
  }

  respondWith(
    attachments: Array<Partial<MailAttachment> & { name: string; content: Buffer }>,
  ): void {
    this.outcome = {
      kind: 'OK',
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
