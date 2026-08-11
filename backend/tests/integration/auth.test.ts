import type { Express } from 'express';
import request from 'supertest';

import { seedBaseline } from '../helpers/seed-baseline';
import { buildTestApp, closeTestQueueProviders } from '../helpers/test-app';
import { truncateAll } from '../helpers/test-database';

import { env } from '@/config/env';
import { prisma } from '@/infra/prisma/client';
import { closeSharedRedisClient } from '@/infra/queue/connection';

const AUTH_BASE = `${env.API_PREFIX}/auth`;

describe('Fluxos de autenticação (integração)', () => {
  let app: Express;

  beforeAll(() => {
    app = buildTestApp(prisma);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await seedBaseline(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await closeTestQueueProviders();
    await closeSharedRedisClient();
    await prisma.$disconnect();
  });

  describe('POST /auth/register', () => {
    it('cria conta ACTIVE com token quando o domínio é reconhecido', async () => {
      const response = await request(app).post(`${AUTH_BASE}/register`).send({
        name: 'Ana Souza',
        email: 'ana@opusce-teste.com.br',
        password: 'SenhaForte1',
      });

      expect(response.status).toBe(201);
      const body = response.body as { status: string; accessToken: string; user: { role: string } };
      expect(body.status).toBe('ACTIVE');
      expect(body.accessToken).toBeTruthy();
      expect(body.user.role).toBe('OPERATIONAL');
      expect(response.headers['set-cookie']).toBeDefined();
    });

    it('cria conta PENDING sem token quando o domínio é desconhecido', async () => {
      const response = await request(app).post(`${AUTH_BASE}/register`).send({
        name: 'Bruno Lima',
        email: 'bruno@dominio-desconhecido.com',
        password: 'SenhaForte1',
      });

      expect(response.status).toBe(202);
      const body = response.body as { status: string };
      expect(body.status).toBe('PENDING');
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('rejeita senha fora da política com 400 VALIDATION_ERROR', async () => {
      const response = await request(app).post(`${AUTH_BASE}/register`).send({
        name: 'Carla',
        email: 'carla@opusce-teste.com.br',
        password: 'fraca',
      });

      expect(response.status).toBe(400);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/login', () => {
    async function registerActiveUser(): Promise<void> {
      await request(app).post(`${AUTH_BASE}/register`).send({
        name: 'Diana',
        email: 'diana@opusce-teste.com.br',
        password: 'SenhaForte1',
      });
    }

    it('autentica com credenciais válidas', async () => {
      await registerActiveUser();

      const response = await request(app)
        .post(`${AUTH_BASE}/login`)
        .send({ email: 'diana@opusce-teste.com.br', password: 'SenhaForte1' });

      expect(response.status).toBe(200);
      const body = response.body as { accessToken: string; expiresIn: number };
      expect(body.accessToken).toBeTruthy();
      expect(body.expiresIn).toBeGreaterThan(0);
    });

    it('rejeita credenciais inválidas com 401', async () => {
      await registerActiveUser();

      const response = await request(app)
        .post(`${AUTH_BASE}/login`)
        .send({ email: 'diana@opusce-teste.com.br', password: 'SenhaErrada1' });

      expect(response.status).toBe(401);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejeita conta pendente com 403 ACCOUNT_PENDING', async () => {
      await request(app).post(`${AUTH_BASE}/register`).send({
        name: 'Bruno',
        email: 'bruno@dominio-desconhecido.com',
        password: 'SenhaForte1',
      });

      const response = await request(app)
        .post(`${AUTH_BASE}/login`)
        .send({ email: 'bruno@dominio-desconhecido.com', password: 'SenhaForte1' });

      expect(response.status).toBe(403);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('ACCOUNT_PENDING');
    });
  });

  describe('POST /auth/refresh e POST /auth/logout', () => {
    it('rotaciona o refresh token via cookie e o antigo passa a falhar', async () => {
      const registerResponse = await request(app).post(`${AUTH_BASE}/register`).send({
        name: 'Ana',
        email: 'ana2@opusce-teste.com.br',
        password: 'SenhaForte1',
      });

      const cookies = registerResponse.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();

      const refreshResponse = await request(app)
        .post(`${AUTH_BASE}/refresh`)
        .set('Cookie', cookies);
      expect(refreshResponse.status).toBe(200);
      const refreshBody = refreshResponse.body as { accessToken: string };
      expect(refreshBody.accessToken).toBeTruthy();

      // O cookie antigo (token já rotacionado) agora falha.
      const reuseResponse = await request(app).post(`${AUTH_BASE}/refresh`).set('Cookie', cookies);
      expect(reuseResponse.status).toBe(401);
    });

    it('logout revoga o token e responde 204', async () => {
      const registerResponse = await request(app).post(`${AUTH_BASE}/register`).send({
        name: 'Ana',
        email: 'ana3@opusce-teste.com.br',
        password: 'SenhaForte1',
      });
      const cookies = registerResponse.headers['set-cookie'] as unknown as string[];

      const logoutResponse = await request(app).post(`${AUTH_BASE}/logout`).set('Cookie', cookies);
      expect(logoutResponse.status).toBe(204);

      const refreshAfterLogout = await request(app)
        .post(`${AUTH_BASE}/refresh`)
        .set('Cookie', cookies);
      expect(refreshAfterLogout.status).toBe(401);
    });

    it('refresh sem cookie responde 401', async () => {
      const response = await request(app).post(`${AUTH_BASE}/refresh`);
      expect(response.status).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    it('devolve usuário, organização e permissões para token válido', async () => {
      const registerResponse = await request(app).post(`${AUTH_BASE}/register`).send({
        name: 'Ana',
        email: 'ana4@opusce-teste.com.br',
        password: 'SenhaForte1',
      });
      const { accessToken } = registerResponse.body as { accessToken: string };

      const response = await request(app)
        .get(`${AUTH_BASE}/me`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      const body = response.body as {
        email: string;
        organization: { name: string } | null;
        permissions: string[];
      };
      expect(body.email).toBe('ana4@opusce-teste.com.br');
      expect(body.organization?.name).toBe('Opusce Teste');
      expect(body.permissions).toContain('process:create');
    });

    it('rejeita requisição sem token com 401', async () => {
      const response = await request(app).get(`${AUTH_BASE}/me`);
      expect(response.status).toBe(401);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejeita token com assinatura inválida com 401', async () => {
      const response = await request(app)
        .get(`${AUTH_BASE}/me`)
        .set('Authorization', 'Bearer token-invalido');
      expect(response.status).toBe(401);
    });
  });
});
