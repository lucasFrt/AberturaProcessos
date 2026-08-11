import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import type { Mailer, MailMessage } from '@/domain/mail/mailer';

export interface NodemailerMailerConfig {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string | undefined;
  password?: string | undefined;
}

/**
 * Implementação de `Mailer` sobre Nodemailer (docs/07). Em desenvolvimento,
 * `host`/`port` apontam para o Mailpit (`localhost:1025`, incluído no
 * `docker-compose.yml`), que não exige autenticação — por isso `auth` só é
 * incluído quando `user`/`password` estão definidos.
 */
export class NodemailerMailer implements Mailer {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: NodemailerMailerConfig) {
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user && config.password
        ? { auth: { user: config.user, pass: config.password } }
        : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      ...(message.bcc && message.bcc.length > 0 ? { bcc: message.bcc } : {}),
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}
