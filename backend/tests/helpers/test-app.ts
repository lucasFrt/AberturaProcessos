import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

import type { Container } from '@/container';
import { createApp } from '@/http/app';
import type { RateLimiters } from '@/http/middlewares/rate-limit';

/**
 * Cada `createApp` monta um `BullMqQueueProvider` novo (docs/07), que abre
 * sua própria conexão ioredis independente do cliente compartilhado de
 * `infra/queue/connection.ts`. Sem fechar essas conexões, o processo do
 * Jest fica com handles abertos ao final da suíte. Este registro permite
 * fechá-las todas de uma vez em `closeTestQueueProviders`, chamado no
 * `afterAll` de cada arquivo de teste de integração.
 */
const createdQueueProviders: Container['queueProvider'][] = [];

/**
 * Monta o app real para os testes de integração (docs/09). O Prisma é
 * injetado por parâmetro em `createApp`, então basta passar a instância
 * conectada ao banco de teste. `rateLimiters` é opcional — testes que
 * precisam de limites baixos (Tarefa 6) constroem o próprio conjunto via
 * `buildRateLimiters` e passam aqui; os demais usam o padrão de produção.
 */
export function buildTestApp(prisma: PrismaClient, rateLimiters?: RateLimiters): Express {
  const app = rateLimiters ? createApp(prisma, rateLimiters) : createApp(prisma);
  const container = app.get('container') as Container;
  createdQueueProviders.push(container.queueProvider);
  return app;
}

/** Fecha todos os `BullMqQueueProvider` criados por `buildTestApp` neste arquivo de teste. */
export async function closeTestQueueProviders(): Promise<void> {
  await Promise.all(createdQueueProviders.map((provider) => provider.close()));
  createdQueueProviders.length = 0;
}
