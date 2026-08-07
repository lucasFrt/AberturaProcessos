import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

import { createApp } from '@/http/app';

/**
 * Monta o app real para os testes de integração (docs/09). O Prisma é
 * injetado por parâmetro em `createApp`, então basta passar a instância
 * conectada ao banco de teste.
 */
export function buildTestApp(prisma: PrismaClient): Express {
  return createApp(prisma);
}
