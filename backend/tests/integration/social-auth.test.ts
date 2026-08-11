import type { Express } from 'express';
import request from 'supertest';

import { buildTestApp, closeTestQueueProviders } from '../helpers/test-app';
import { truncateAll } from '../helpers/test-database';

import { env } from '@/config/env';
import { prisma } from '@/infra/prisma/client';
import { closeSharedRedisClient } from '@/infra/queue/connection';

const AUTH_BASE = `${env.API_PREFIX}/auth`;

/**
 * Tarefa 5, critério de aceite: "provedor sem credencial não impede a
 * subida da API". `.env.test` não define credenciais OAuth — se a API
 * subiu (o que `buildTestApp` já faz para todos os outros testes), esse
 * critério já está coberto; aqui verificamos o reflexo no contrato HTTP:
 * `/auth/providers` reporta os dois como `false` e as rotas de callback
 * simplesmente não existem (404), em vez de quebrar.
 */
describe('Login social — configuração de provedores (integração)', () => {
  let app: Express;

  beforeAll(() => {
    app = buildTestApp(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await closeTestQueueProviders();
    await closeSharedRedisClient();
    await prisma.$disconnect();
  });

  it('GET /auth/providers informa local=true e os sociais desabilitados sem credencial', async () => {
    const response = await request(app).get(`${AUTH_BASE}/providers`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ local: true, google: false, microsoft: false });
  });

  it('GET /auth/google responde 404 quando o provedor não está configurado', async () => {
    const response = await request(app).get(`${AUTH_BASE}/google`);
    expect(response.status).toBe(404);
  });

  it('GET /auth/microsoft responde 404 quando o provedor não está configurado', async () => {
    const response = await request(app).get(`${AUTH_BASE}/microsoft`);
    expect(response.status).toBe(404);
  });
});
