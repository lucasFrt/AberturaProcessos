import type { Express } from 'express';
import request from 'supertest';

import { seedBaseline } from '../helpers/seed-baseline';
import { buildTestApp } from '../helpers/test-app';
import { truncateAll } from '../helpers/test-database';

import { env } from '@/config/env';
import { buildRateLimiters, type RateLimiters } from '@/http/middlewares/rate-limit';
import { prisma } from '@/infra/prisma/client';
import { closeSharedRedisClient } from '@/infra/queue/connection';

const AUTH_BASE = `${env.API_PREFIX}/auth`;

/**
 * Tarefa 6, critério de aceite: "11ª tentativa de login em 15 min responde
 * 429 com Retry-After", "CLIENT estoura em 120 req/min", "ADMIN não é
 * bloqueado no mesmo volume". Os limitadores são injetados com janelas
 * baixas via `buildRateLimiters` — nunca lidos do `.env` real — para que o
 * teste não precise de 11 requisições reais de 15 minutos.
 */
describe('Rate limiting (integração)', () => {
  function buildAppWithLimiters(
    overrides: Partial<Parameters<typeof buildRateLimiters>[0]>,
  ): Express {
    const rateLimiters: RateLimiters = buildRateLimiters({
      authMaxRequests: 3,
      authWindowMs: 60_000,
      refreshMaxRequests: 60,
      refreshWindowMs: 60_000,
      oauthCallbackMaxRequests: 30,
      oauthCallbackWindowMs: 60_000,
      clientMaxRequests: 3,
      clientWindowMs: 60_000,
      internalMaxRequests: 1000,
      internalWindowMs: 60_000,
      uploadMaxRequests: 30,
      uploadWindowMs: 60_000,
      anonymousMaxRequests: 60,
      anonymousWindowMs: 60_000,
      ...overrides,
    });
    return buildTestApp(prisma, rateLimiters);
  }

  beforeEach(async () => {
    await truncateAll(prisma);
    await seedBaseline(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await closeSharedRedisClient();
    await prisma.$disconnect();
  });

  describe('POST /auth/login', () => {
    it('responde 429 RATE_LIMIT_EXCEEDED com Retry-After após estourar o limite de auth', async () => {
      const app = buildAppWithLimiters({});

      const email = 'usuario-rate-limit@dominio-desconhecido.com';
      const credentials = { email, password: 'SenhaErrada1' };

      // authMaxRequests: 3 — as 3 primeiras contam contra o limite (mesmo
      // falhando por credenciais inválidas); a 4ª estoura.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await request(app).post(`${AUTH_BASE}/login`).send(credentials);
        expect(response.status).toBe(401);
      }

      const blockedResponse = await request(app).post(`${AUTH_BASE}/login`).send(credentials);

      expect(blockedResponse.status).toBe(429);
      expect(blockedResponse.headers['retry-after']).toBeDefined();
      const body = blockedResponse.body as { error: { code: string } };
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('não conta tentativas de e-mails diferentes contra a mesma chave', async () => {
      const app = buildAppWithLimiters({});

      // authMaxRequests: 3 — 3 tentativas de e-mails distintos não devem
      // ser somadas na mesma chave (chave é IP + e-mail normalizado).
      for (let i = 0; i < 3; i += 1) {
        const response = await request(app)
          .post(`${AUTH_BASE}/login`)
          .send({ email: `usuario-${i}@dominio-desconhecido.com`, password: 'SenhaErrada1' });
        expect(response.status).toBe(401);
      }

      const response = await request(app)
        .post(`${AUTH_BASE}/login`)
        .send({ email: 'usuario-novo@dominio-desconhecido.com', password: 'SenhaErrada1' });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /auth/me (rateLimitByRole)', () => {
    async function registerAndLogin(app: Express, email: string): Promise<{ accessToken: string }> {
      const registerResponse = await request(app).post(`${AUTH_BASE}/register`).send({
        name: 'Usuário de Teste',
        email,
        password: 'SenhaForte1',
      });
      const body = registerResponse.body as { accessToken: string };
      return { accessToken: body.accessToken };
    }

    it('CLIENT estoura o limite antes do ADMIN/OPERATIONAL no mesmo volume', async () => {
      const app = buildAppWithLimiters({ clientMaxRequests: 3 });

      const { accessToken: clientToken } = await registerAndLogin(
        app,
        'cliente-rl@clientex-teste.com.br',
      );
      const { accessToken: operationalToken } = await registerAndLogin(
        app,
        'operacional-rl@opusce-teste.com.br',
      );

      // clientMaxRequests: 3 — a 4ª requisição do CLIENT estoura.
      for (let i = 0; i < 3; i += 1) {
        const response = await request(app)
          .get(`${AUTH_BASE}/me`)
          .set('Authorization', `Bearer ${clientToken}`);
        expect(response.status).toBe(200);
      }
      const blockedClientResponse = await request(app)
        .get(`${AUTH_BASE}/me`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(blockedClientResponse.status).toBe(429);

      // OPERATIONAL, com o mesmo volume de requisições, usa o limitador
      // interno (bem mais alto) e não é bloqueado.
      for (let i = 0; i < 4; i += 1) {
        const response = await request(app)
          .get(`${AUTH_BASE}/me`)
          .set('Authorization', `Bearer ${operationalToken}`);
        expect(response.status).toBe(200);
      }
    });
  });
});
