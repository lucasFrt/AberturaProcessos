import request from 'supertest';

import { env } from '@/config/env';
import { createApp } from '@/http/app';
import { prisma } from '@/infra/prisma/client';
import { closeSharedRedisClient } from '@/infra/queue/connection';

describe('Rotas de saúde', () => {
  const app = createApp();

  afterAll(async () => {
    await closeSharedRedisClient();
    await prisma.$disconnect();
  });

  describe('GET /health', () => {
    it('retorna 200 com status ok, na raiz e sob o prefixo da API', async () => {
      for (const path of ['/health', `${env.API_PREFIX}/health`]) {
        const response = await request(app).get(path);
        const body = response.body as { status: string; uptime: number; version: string };

        expect(response.status).toBe(200);
        expect(body).toMatchObject({ status: 'ok', version: env.APP_VERSION });
        expect(typeof body.uptime).toBe('number');
      }
    });
  });

  describe('GET /health/ready', () => {
    it('verifica o estado real de banco e Redis', async () => {
      const response = await request(app).get('/health/ready');
      const body = response.body as { status: string; checks: { database: string; redis: string } };

      expect([200, 503]).toContain(response.status);
      expect(body.checks).toHaveProperty('database');
      expect(body.checks).toHaveProperty('redis');
      expect(['ok', 'down']).toContain(body.checks.database);
      expect(['ok', 'down']).toContain(body.checks.redis);
    });
  });

  describe('rota inexistente', () => {
    it('responde 404 no envelope de erro padrão, com requestId', async () => {
      const response = await request(app).get('/rota-que-nao-existe');
      const body = response.body as {
        error: { code: string; message: string; requestId?: string };
      };

      expect(response.status).toBe(404);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(typeof body.error.requestId).toBe('string');
      expect(response.headers['x-request-id']).toBe(body.error.requestId);
    });
  });
});
