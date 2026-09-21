import { env } from '@/config/env';
import type { Container } from '@/container';
import { createApp } from '@/http/app';
import { logger } from '@/infra/logger';
import { prisma } from '@/infra/prisma/client';
import { PrismaUserRepository } from '@/infra/prisma/repositories/prisma-user-repository';
import { closeSharedRedisClient } from '@/infra/queue/connection';
import { SocketIoProvider } from '@/infra/realtime/socket-io-provider';
import { JwtTokenService } from '@/infra/security/token-service';
import { ensureStorageRootExists } from '@/infra/storage/local-disk-storage';
import { IlogSyncJob } from '@/jobs/ilog-sync-job';
import { AccessScopeResolver } from '@/services/access-scope-resolver';

const app = createApp(prisma);
const container = app.get('container') as Container;

let server: ReturnType<typeof app.listen>;
let realtimeProvider: SocketIoProvider | undefined;
let ilogSyncJob: IlogSyncJob | undefined;

// STORAGE_ROOT criado de forma idempotente na subida (docs/10, RNF-11) —
// nunca falha silenciosamente: se não for gravável, a Promise rejeita e o
// processo aborta antes de aceitar requisições. `module: commonjs` não
// suporta top-level await, daí a IIFE.
void (async (): Promise<void> => {
  await ensureStorageRootExists(env.STORAGE_ROOT);

  server = app.listen(env.PORT, '127.0.0.1', () => {
    logger.info(`API escutando em http://127.0.0.1:${env.PORT}${env.API_PREFIX}`);
  });

  // Socket.IO anexado ao mesmo http.Server do Express (docs/07). O
  // container já foi montado com um DeferredRealtimeProvider (no-op) —
  // `attach` substitui o delegate pelo provider real assim que o
  // http.Server existe, sem precisar reconstruir services/controllers.
  const userRepositoryForSockets = new PrismaUserRepository(prisma);
  realtimeProvider = new SocketIoProvider(server, {
    tokenService: new JwtTokenService(),
    userRepository: userRepositoryForSockets,
    accessScopeResolver: new AccessScopeResolver(userRepositoryForSockets),
  });
  container.realtimeProvider.attach(realtimeProvider);

  // Espelho do iLog (docs/15): agendado aqui, depois do tempo real anexado,
  // para o board receber os processos espelhados sem recarregar.
  if (container.ilogSyncService) {
    ilogSyncJob = new IlogSyncJob(container.ilogSyncService, logger, {
      intervalMinutes: env.ILOG_SYNC_INTERVAL_MINUTES,
    });
    ilogSyncJob.start();
  }
})();

/**
 * Graceful shutdown (RNF-12): fecha o gateway Socket.IO, depois o
 * servidor HTTP, e só então banco e Redis — ordem exata de docs/07
 * ("Encerramento ordenado"): `io.close()` sempre antes de fechar o
 * servidor HTTP, para que o NSSM consiga reiniciar o processo sem
 * interromper requisições/conexões em andamento.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Encerrando');

  ilogSyncJob?.stop();
  if (realtimeProvider) {
    await realtimeProvider.close();
  }
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await container.queueProvider.close();
  await container.shutdown();
  await closeSharedRedisClient();
  await prisma.$disconnect();

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
