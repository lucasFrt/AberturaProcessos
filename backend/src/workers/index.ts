import { env } from '@/config/env';
import { logger } from '@/infra/logger';
import { NodemailerMailer } from '@/infra/mail/nodemailer-mailer';
import { prisma } from '@/infra/prisma/client';
import { closeSharedRedisClient, redisConnectionOptions } from '@/infra/queue/connection';
import { createEmailWorker } from '@/workers/email.worker';

/**
 * Processo separado da API (docs/07): compartilha config, logger e Prisma,
 * mas não abre porta HTTP. Registrado como segundo serviço no NSSM em
 * produção (docs/11); em desenvolvimento, `npm run dev:worker`.
 */
const mailer = new NodemailerMailer({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  from: env.MAIL_FROM,
  user: env.SMTP_USER,
  password: env.SMTP_PASSWORD,
});

const worker = createEmailWorker(
  {
    mailer,
    prisma,
    logger,
    frontendUrl: env.FRONTEND_URL,
    notificationsEnabled: env.EMAIL_NOTIFICATIONS_ENABLED,
  },
  redisConnectionOptions,
);

logger.info('Worker de e-mail escutando a fila "email"');

/**
 * Encerramento ordenado (RNF-12): `worker.close()` espera o job corrente
 * terminar antes de fechar, para que um restart não interrompa um job no
 * meio e duplique o e-mail na retentativa (docs/07).
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Encerrando worker');

  await worker.close();
  await closeSharedRedisClient();
  await prisma.$disconnect();

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
