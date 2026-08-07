import { env } from '@/config/env';
import { createApp } from '@/http/app';
import { logger } from '@/infra/logger';

const app = createApp();

const server = app.listen(env.PORT, '127.0.0.1', () => {
  logger.info(`server placeholder: escutando em http://127.0.0.1:${env.PORT}`);
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Encerrando');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
