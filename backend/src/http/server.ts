import { env } from '@/config/env';
import { createApp } from '@/http/app';
import { logger } from '@/infra/logger';
import { prisma } from '@/infra/prisma/client';
import { closeSharedRedisClient } from '@/infra/queue/connection';
import { ensureStorageRootExists } from '@/infra/storage/local-disk-storage';

const app = createApp(prisma);

let server: ReturnType<typeof app.listen>;

// STORAGE_ROOT criado de forma idempotente na subida (docs/10, RNF-11) —
// nunca falha silenciosamente: se não for gravável, a Promise rejeita e o
// processo aborta antes de aceitar requisições. `module: commonjs` não
// suporta top-level await, daí a IIFE.
void (async (): Promise<void> => {
  await ensureStorageRootExists(env.STORAGE_ROOT);

  server = app.listen(env.PORT, '127.0.0.1', () => {
    logger.info(`API escutando em http://127.0.0.1:${env.PORT}${env.API_PREFIX}`);
  });
})();

/**
 * Graceful shutdown (RNF-12): fecha o servidor HTTP antes de desconectar
 * banco e Redis, para que o NSSM consiga reiniciar o processo sem
 * interromper requisições em andamento.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Encerrando');

  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeSharedRedisClient();
  await prisma.$disconnect();

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
