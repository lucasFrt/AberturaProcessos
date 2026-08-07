import Redis from 'ioredis';

import { env } from '@/config/env';
import { logger } from '@/infra/logger';

/**
 * Opções de conexão compartilhadas entre o health check e o futuro
 * BullMqQueueProvider (Tarefa 12). `maxRetriesPerRequest: null` é exigido
 * pelo BullMQ para não abortar comandos bloqueantes durante reconexões
 * (docs/07-filas-notificacoes-realtime.md).
 *
 * `password` só é incluída quando definida: com `exactOptionalPropertyTypes`,
 * `password: undefined` não é o mesmo que omitir a propriedade.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- retorno inferido de propósito: anotar como RedisOptions reintroduz incompatibilidade de tipos do ioredis com exactOptionalPropertyTypes
function buildRedisConnectionOptions() {
  const base = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  };

  return env.REDIS_PASSWORD ? { ...base, password: env.REDIS_PASSWORD } : base;
}

export const redisConnectionOptions = buildRedisConnectionOptions();

let sharedClient: Redis | null = null;

function getSharedClient(): Redis {
  sharedClient ??= new Redis(redisConnectionOptions);
  return sharedClient;
}

export async function checkRedisConnection(): Promise<boolean> {
  const client = getSharedClient();

  try {
    if (client.status === 'wait' || client.status === 'end') {
      await client.connect();
    }
    const reply = await client.ping();
    return reply === 'PONG';
  } catch (error) {
    logger.error({ err: error }, 'Falha ao verificar conexão com o Redis');
    return false;
  }
}

export async function closeSharedRedisClient(): Promise<void> {
  if (sharedClient) {
    await sharedClient.quit();
    sharedClient = null;
  }
}
