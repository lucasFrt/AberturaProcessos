import { PrismaClient } from '@prisma/client';

import { env } from '@/config/env';
import { logger } from '@/infra/logger';

/**
 * Instância única do Prisma Client para todo o processo. Repositórios em
 * `infra/prisma/repositories` recebem esta instância por injeção, nunca a
 * importam diretamente uns dos outros.
 */
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Falha ao verificar conexão com o banco');
    return false;
  }
}
