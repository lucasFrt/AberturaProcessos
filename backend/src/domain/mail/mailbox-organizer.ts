/**
 * Organização da caixa pelo próprio backend (docs/13, decisão 12): o e-mail
 * que virou processo (ou documento de processo) é **copiado** para uma
 * pasta por organização — `Processos IA/<Organização>/` — na mesma caixa.
 * Copiado, nunca movido: a caixa de entrada que o operacional usa não é
 * tocada. É o que substitui o relatório por e-mail. Exige
 * `Application Mail.ReadWrite` no Exchange; com `Mail.Read` a cópia falha
 * com `FORBIDDEN` e o intake segue normalmente (a cópia é best-effort).
 */

export type CopyToFolderOutcome =
  /** `copiedMessageId` é o id da cópia (a original continua na caixa de entrada). */
  | { kind: 'OK'; copiedMessageId: string | null }
  | { kind: 'MESSAGE_NOT_FOUND' }
  /** Sem permissão de escrita na caixa (papel `Application Mail.ReadWrite` ausente). */
  | { kind: 'FORBIDDEN' }
  | { kind: 'UNAVAILABLE'; reason: string };

export interface MailboxOrganizer {
  /**
   * Copia a mensagem para a pasta indicada por `folderPath` (do topo para a
   * folha, ex.: `['Processos IA', 'Casa & Novidade']`), criando as pastas
   * que faltarem.
   */
  copyMessageToFolder(messageId: string, folderPath: string[]): Promise<CopyToFolderOutcome>;
}
