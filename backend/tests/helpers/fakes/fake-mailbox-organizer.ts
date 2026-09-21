import type { CopyToFolderOutcome, MailboxOrganizer } from '@/domain/mail/mailbox-organizer';

/** Dublê de `MailboxOrganizer` (docs/09): registra as cópias pedidas; `outcome` é a resposta. */
export class FakeMailboxOrganizer implements MailboxOrganizer {
  readonly copies: Array<{ messageId: string; folderPath: string[] }> = [];
  outcome: CopyToFolderOutcome = { kind: 'OK', copiedMessageId: 'copy-1' };

  async copyMessageToFolder(messageId: string, folderPath: string[]): Promise<CopyToFolderOutcome> {
    this.copies.push({ messageId, folderPath: [...folderPath] });
    return this.outcome;
  }
}
