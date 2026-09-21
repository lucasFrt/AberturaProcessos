import type {
  GetMailboxMessageOutcome,
  ListMailboxOptions,
  ListMailboxOutcome,
  MailboxMessageDetail,
  MailboxReader,
} from '@/domain/mail/mailbox-reader';

/**
 * Dublê de `MailboxReader` (docs/09): nenhuma chamada ao Graph. Guarda as
 * mensagens em memória e reproduz a semântica de `after` (exclusivo),
 * ordem crescente e `hasMore`.
 */
export class FakeMailboxReader implements MailboxReader {
  readonly messages: MailboxMessageDetail[] = [];
  readonly listCalls: ListMailboxOptions[] = [];
  readonly getCalls: string[] = [];
  unavailable: string | null = null;

  async listMessages(options: ListMailboxOptions): Promise<ListMailboxOutcome> {
    this.listCalls.push(options);
    if (this.unavailable) return { kind: 'UNAVAILABLE', reason: this.unavailable };
    const sorted = [...this.messages]
      .filter((message) => message.receivedAt.getTime() > options.after.getTime())
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    const page = sorted.slice(0, options.limit).map((message) => ({
      id: message.id,
      internetMessageId: message.internetMessageId,
      subject: message.subject,
      from: message.from,
      receivedAt: message.receivedAt,
      hasAttachments: message.hasAttachments,
      preview: message.preview,
    }));
    return { kind: 'OK', messages: page, hasMore: sorted.length > options.limit };
  }

  async getMessage(messageId: string): Promise<GetMailboxMessageOutcome> {
    this.getCalls.push(messageId);
    if (this.unavailable) return { kind: 'UNAVAILABLE', reason: this.unavailable };
    const message = this.messages.find((item) => item.id === messageId);
    return message ? { kind: 'OK', message } : { kind: 'MESSAGE_NOT_FOUND' };
  }

  add(
    partial: Partial<MailboxMessageDetail> & { id: string; receivedAt: Date },
  ): MailboxMessageDetail {
    const message: MailboxMessageDetail = {
      internetMessageId: `<${partial.id}@fake>`,
      subject: '',
      from: { name: null, email: null },
      hasAttachments: false,
      preview: '',
      to: [],
      cc: [],
      bodyText: '',
      attachments: [],
      ...partial,
    };
    this.messages.push(message);
    return message;
  }
}
