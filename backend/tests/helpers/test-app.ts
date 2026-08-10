import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

import { createApp } from '@/http/app';
import type { RateLimiters } from '@/http/middlewares/rate-limit';

/**
 * Monta o app real para os testes de integração (docs/09). O Prisma é
 * injetado por parâmetro em `createApp`, então basta passar a instância
 * conectada ao banco de teste. `rateLimiters` é opcional — testes que
 * precisam de limites baixos (Tarefa 6) constroem o próprio conjunto via
 * `buildRateLimiters` e passam aqui; os demais usam o padrão de produção.
 */
export function buildTestApp(prisma: PrismaClient, rateLimiters?: RateLimiters): Express {
  return rateLimiters ? createApp(prisma, rateLimiters) : createApp(prisma);
}
