import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';

import { seedBaseline } from '../helpers/seed-baseline';
import { buildTestApp, closeTestQueueProviders } from '../helpers/test-app';
import { truncateAll } from '../helpers/test-database';

import { env } from '@/config/env';
import { buildRateLimiters } from '@/http/middlewares/rate-limit';
import { prisma } from '@/infra/prisma/client';
import { closeSharedRedisClient } from '@/infra/queue/connection';
import { BcryptPasswordHasher } from '@/infra/security/password-hasher';

const STAGES_BASE = `${env.API_PREFIX}/stages`;
const AUTH_BASE = `${env.API_PREFIX}/auth`;

async function createAdminAndLogin(
  client: PrismaClient,
  app: Express,
  organizationId: string,
  email: string,
): Promise<string> {
  const passwordHasher = new BcryptPasswordHasher();
  const passwordHash = await passwordHasher.hash('SenhaForte1');

  await client.user.create({
    data: {
      name: 'Admin Teste',
      email,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      accessScope: 'ORGANIZATION',
      organizationId,
    },
  });

  const response = await request(app)
    .post(`${AUTH_BASE}/login`)
    .send({ email, password: 'SenhaForte1' });

  const body = response.body as { accessToken: string };
  return body.accessToken;
}

async function createClientAndLogin(app: Express, email: string): Promise<string> {
  const registerResponse = await request(app).post(`${AUTH_BASE}/register`).send({
    name: 'Cliente Teste',
    email,
    password: 'SenhaForte1',
  });
  const body = registerResponse.body as { accessToken?: string; status: string };
  if (body.status !== 'ACTIVE' || !body.accessToken) {
    throw new Error('Setup de cliente falhou: domínio não reconhecido.');
  }
  return body.accessToken;
}

describe('Etapas do Kanban — integração', () => {
  let app: Express;
  let internalOrganizationId: string;
  let clientOrganizationId: string;
  let adminToken: string;

  beforeAll(() => {
    const rateLimiters = buildRateLimiters({
      authMaxRequests: 1000,
      authWindowMs: 60_000,
      refreshMaxRequests: 1000,
      refreshWindowMs: 60_000,
      oauthCallbackMaxRequests: 1000,
      oauthCallbackWindowMs: 60_000,
      clientMaxRequests: 1000,
      clientWindowMs: 60_000,
      internalMaxRequests: 1000,
      internalWindowMs: 60_000,
      uploadMaxRequests: 1000,
      uploadWindowMs: 60_000,
      anonymousMaxRequests: 1000,
      anonymousWindowMs: 60_000,
    });
    app = buildTestApp(prisma, rateLimiters);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    const baseline = await seedBaseline(prisma);
    internalOrganizationId = baseline.internalOrganizationId;
    clientOrganizationId = baseline.clientOrganizationId;
    adminToken = await createAdminAndLogin(
      prisma,
      app,
      internalOrganizationId,
      'admin@opusce-teste.com.br',
    );
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await closeTestQueueProviders();
    await closeSharedRedisClient();
    await prisma.$disconnect();
  });

  describe('Criação', () => {
    it('nova etapa entra sempre no fim da ordem atual', async () => {
      const first = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Entrada' });
      expect(first.status).toBe(201);
      expect((first.body as { order: number }).order).toBe(0);

      const second = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Em Andamento' });
      expect(second.status).toBe(201);
      expect((second.body as { order: number }).order).toBe(1);

      const third = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Concluído', isFinal: true });
      expect(third.status).toBe(201);
      expect((third.body as { order: number }).order).toBe(2);
    });

    it('responde 409 CONFLICT para nome duplicado', async () => {
      await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Entrada' });

      const response = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Entrada' });

      expect(response.status).toBe(409);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  describe('Reordenação', () => {
    it('PATCH /stages/reorder persiste a nova ordem e a listagem reflete', async () => {
      const first = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Entrada' });
      const second = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Em Andamento' });
      const third = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Concluído' });

      const firstId = (first.body as { id: string }).id;
      const secondId = (second.body as { id: string }).id;
      const thirdId = (third.body as { id: string }).id;

      const reorderResponse = await request(app)
        .patch(`${STAGES_BASE}/reorder`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stageIds: [thirdId, firstId, secondId] });

      expect(reorderResponse.status).toBe(200);

      const listResponse = await request(app)
        .get(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`);

      const body = listResponse.body as { data: Array<{ id: string; order: number }> };
      expect(body.data.map((stage) => stage.id)).toEqual([thirdId, firstId, secondId]);
      expect(body.data.map((stage) => stage.order)).toEqual([0, 1, 2]);
    });
  });

  describe('Exclusão', () => {
    it('responde 409 STAGE_NOT_EMPTY com processCount ao excluir etapa com processos ativos', async () => {
      const stageResponse = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Entrada' });
      await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Em Andamento' });
      const stageId = (stageResponse.body as { id: string }).id;

      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Com Processo',
          organizationId: clientOrganizationId,
        },
      });
      const admin = await prisma.user.findFirst({ where: { email: 'admin@opusce-teste.com.br' } });
      await prisma.process.create({
        data: {
          code: 'PRC-2026-STAGE1',
          reference: 'Processo de teste',
          clientCompanyId: company.id,
          currentStageId: stageId,
          createdById: admin!.id,
        },
      });

      const deleteResponse = await request(app)
        .delete(`${STAGES_BASE}/${stageId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteResponse.status).toBe(409);
      const body = deleteResponse.body as { error: { code: string; details: unknown } };
      expect(body.error.code).toBe('STAGE_NOT_EMPTY');
      expect(body.error.details).toMatchObject({ processCount: 1 });
    });

    it('responde 409 ao excluir a última etapa restante', async () => {
      const stageResponse = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Única' });
      const stageId = (stageResponse.body as { id: string }).id;

      const deleteResponse = await request(app)
        .delete(`${STAGES_BASE}/${stageId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteResponse.status).toBe(409);
      const body = deleteResponse.body as { error: { code: string } };
      expect(body.error.code).toBe('CONFLICT');
    });

    it('exclui etapa sem processos, quando não é a última', async () => {
      const first = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Entrada' });
      await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Em Andamento' });
      const firstId = (first.body as { id: string }).id;

      const deleteResponse = await request(app)
        .delete(`${STAGES_BASE}/${firstId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteResponse.status).toBe(204);
    });
  });

  describe('Listagem com contagem', () => {
    it('?withCounts=true traz processCount por etapa', async () => {
      const stageResponse = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Entrada' });
      const stageId = (stageResponse.body as { id: string }).id;

      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Com Processo',
          organizationId: clientOrganizationId,
        },
      });
      const admin = await prisma.user.findFirst({ where: { email: 'admin@opusce-teste.com.br' } });
      await prisma.process.create({
        data: {
          code: 'PRC-2026-STAGE2',
          reference: 'Processo de teste',
          clientCompanyId: company.id,
          currentStageId: stageId,
          createdById: admin!.id,
        },
      });

      const listResponse = await request(app)
        .get(`${STAGES_BASE}?withCounts=true`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listResponse.status).toBe(200);
      const body = listResponse.body as { data: Array<{ id: string; processCount: number }> };
      const stage = body.data.find((item) => item.id === stageId);
      expect(stage?.processCount).toBe(1);
    });
  });

  describe('Autorização por papel', () => {
    it('CLIENT recebe 403 ao tentar criar, reordenar ou excluir etapa', async () => {
      const clientToken = await createClientAndLogin(app, 'cliente1@clientex-teste.com.br');

      const createResponse = await request(app)
        .post(STAGES_BASE)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ name: 'Entrada' });
      expect(createResponse.status).toBe(403);

      const reorderResponse = await request(app)
        .patch(`${STAGES_BASE}/reorder`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ stageIds: ['x'] });
      expect(reorderResponse.status).toBe(403);
    });

    it('CLIENT consegue listar etapas (leitura liberada a autenticados)', async () => {
      const clientToken = await createClientAndLogin(app, 'cliente2@clientex-teste.com.br');

      const response = await request(app)
        .get(STAGES_BASE)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(200);
    });
  });
});
