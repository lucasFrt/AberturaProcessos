/**
 * Abstração de envio de e-mail (docs/07). Vive no domínio pelo mesmo
 * motivo de `QueueProvider`/`StorageProvider`: quem monta a mensagem (o
 * worker, não um service HTTP síncrono, mas a regra é a mesma de camadas)
 * depende só desta interface, nunca do Nodemailer diretamente.
 */
export interface MailMessage {
  to: string[];
  bcc?: string[] | undefined;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
