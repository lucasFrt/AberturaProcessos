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

const DASHBOARD_BASE = `${env.API_PREFIX}/dashboard`;
const AUTH_BASE = `${env.API_PREFIX}/auth`;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface DashboardMetricsResponse {
  period: { from: string; to: string };
  totals: {
    processes: number;
    active: number;
    completed: number;
    createdInPeriod: number;
    completedInPeriod: number;
  };
  byStage: Array<{ stageId: string; stageName: string; count: number }>;
  byCompany: Array<{ companyId: string; count: number }>;
  byOrganization: Array<{ organizationId: string; count: number }>;
  completionTime: {
    averageHours: number;
    medianHours: number;
    formatted: string;
    sampleSize: number;
  };
  averageTimePerStage: Array<{
    stageId: string;
    stageName: string;
    averageHours: number;
    sampleSize: number;
  }>;
  throughputByDay: Array<{ date: string; created: number; completed: number }>;
}

async function createUserAndLogin(
  client: PrismaClient,
  app: Express,
  organizationId: string,
  email: string,
  role: 'ADMIN' | 'OPERATIONAL',
): Promise<string> {
  const passwordHasher = new BcryptPasswordHasher();
  const passwordHash = await passwordHasher.hash('SenhaForte1');

  await client.user.create({
    data: {
      name: 'Usuário Teste',
      email,
      passwordHash,
      role,
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

describe('Dashboard de métricas — integração', () => {
  let app: Express;
  let internalOrganizationId: string;
  let clientOrganizationId: string;
  let adminToken: string;
  let adminId: string;
  let stageEntrada: { id: string };
  let stageAndamento: { id: string };
  let stageConcluido: { id: string };
  let company: { id: string };

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

    adminToken = await createUserAndLogin(
      prisma,
      app,
      internalOrganizationId,
      'admin@opusce-teste.com.br',
      'ADMIN',
    );
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@opusce-teste.com.br' },
    });
    adminId = admin.id;

    stageEntrada = await prisma.kanbanStage.create({
      data: { name: 'Entrada', order: 0 },
    });
    stageAndamento = await prisma.kanbanStage.create({
      data: { name: 'Em Andamento', order: 1 },
    });
    stageConcluido = await prisma.kanbanStage.create({
      data: { name: 'Concluído', order: 2, isFinal: true },
    });

    company = await prisma.company.create({
      data: {
        cnpj: '11222333000181',
        legalName: 'Cliente Dashboard LTDA',
        organizationId: clientOrganizationId,
      },
    });
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await closeTestQueueProviders();
    await closeSharedRedisClient();
    await prisma.$disconnect();
  });

  async function createProcess(input: {
    code: string;
    currentStageId: string;
    createdAt: Date;
    completedAt?: Date | null;
    clientCompanyId?: string;
  }): Promise<{ id: string }> {
    return prisma.process.create({
      data: {
        code: input.code,
        reference: `Referência ${input.code}`,
        clientCompanyId: input.clientCompanyId ?? company.id,
        currentStageId: input.currentStageId,
        createdById: adminId,
        createdAt: input.createdAt,
        completedAt: input.completedAt ?? null,
      },
    });
  }

  async function createStageChange(input: {
    processId: string;
    fromStageId: string;
    toStageId: string;
    createdAt: Date;
  }): Promise<void> {
    await prisma.processHistory.create({
      data: {
        processId: input.processId,
        action: 'STAGE_CHANGED',
        fromStageId: input.fromStageId,
        toStageId: input.toStageId,
        actorId: adminId,
        description: 'Mudança de etapa (fixture de teste).',
        createdAt: input.createdAt,
      },
    });
  }

  describe('Autorização', () => {
    it('OPERATIONAL recebe 403', async () => {
      const operationalToken = await createUserAndLogin(
        prisma,
        app,
        internalOrganizationId,
        'operacional@opusce-teste.com.br',
        'OPERATIONAL',
      );

      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics`)
        .set('Authorization', `Bearer ${operationalToken}`);

      expect(response.status).toBe(403);
    });

    it('CLIENT recebe 403', async () => {
      const clientToken = await createClientAndLogin(app, 'cliente1@clientex-teste.com.br');

      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(403);
    });

    it('ADMIN acessa normalmente', async () => {
      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
    });
  });

  describe('Período padrão', () => {
    it('sem from/to usa os últimos 30 dias', async () => {
      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const body = response.body as DashboardMetricsResponse;

      const from = new Date(body.period.from);
      const to = new Date(body.period.to);
      const diffDays = Math.round((to.getTime() - from.getTime()) / DAY_MS);
      expect(diffDays).toBe(30);
    });

    it('período sem dados retorna zeros e sampleSize 0 sem divisão por zero', async () => {
      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const body = response.body as DashboardMetricsResponse;
      expect(body.totals.processes).toBe(0);
      expect(body.completionTime.sampleSize).toBe(0);
      expect(body.completionTime.averageHours).toBe(0);
      expect(body.completionTime.medianHours).toBe(0);
      expect(body.byStage.every((stage) => stage.count === 0)).toBe(true);
    });
  });

  describe('Totais', () => {
    it('conta processos ativos vs concluídos corretamente', async () => {
      const now = new Date();
      const activeProcess = await createProcess({
        code: 'PRC-2026-D0001',
        currentStageId: stageAndamento.id,
        createdAt: now,
        completedAt: null,
      });
      const completedProcess = await createProcess({
        code: 'PRC-2026-D0002',
        currentStageId: stageConcluido.id,
        createdAt: now,
        completedAt: now,
      });

      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const body = response.body as DashboardMetricsResponse;
      expect(body.totals.processes).toBe(2);
      expect(body.totals.active).toBe(1);
      expect(body.totals.completed).toBe(1);
      expect(body.totals.createdInPeriod).toBe(2);
      expect(body.totals.completedInPeriod).toBe(1);
      expect(activeProcess.id).toBeDefined();
      expect(completedProcess.id).toBeDefined();
    });
  });

  describe('byStage', () => {
    it('inclui etapas com 0 processos', async () => {
      await createProcess({
        code: 'PRC-2026-D0003',
        currentStageId: stageEntrada.id,
        createdAt: new Date(),
      });

      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const body = response.body as DashboardMetricsResponse;
      expect(body.byStage).toHaveLength(3);
      const andamento = body.byStage.find((stage) => stage.stageId === stageAndamento.id);
      const concluido = body.byStage.find((stage) => stage.stageId === stageConcluido.id);
      expect(andamento?.count).toBe(0);
      expect(concluido?.count).toBe(0);
      const entrada = body.byStage.find((stage) => stage.stageId === stageEntrada.id);
      expect(entrada?.count).toBe(1);
    });
  });

  describe('completionTime', () => {
    it('calcula average/median/formatted a partir de completedAt - createdAt no período', async () => {
      const now = new Date();

      // 10h, 20h e 60h de duração — average = 30h, median = 20h.
      await createProcess({
        code: 'PRC-2026-D0010',
        currentStageId: stageConcluido.id,
        createdAt: new Date(now.getTime() - 10 * HOUR_MS),
        completedAt: now,
      });
      await createProcess({
        code: 'PRC-2026-D0011',
        currentStageId: stageConcluido.id,
        createdAt: new Date(now.getTime() - 20 * HOUR_MS),
        completedAt: now,
      });
      await createProcess({
        code: 'PRC-2026-D0012',
        currentStageId: stageConcluido.id,
        createdAt: new Date(now.getTime() - 60 * HOUR_MS),
        completedAt: now,
      });

      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const body = response.body as DashboardMetricsResponse;
      expect(body.completionTime.sampleSize).toBe(3);
      expect(body.completionTime.averageHours).toBeCloseTo(30, 1);
      expect(body.completionTime.medianHours).toBeCloseTo(20, 1);
      expect(body.completionTime.formatted).toBe('1d 6h');
    });
  });

  describe('averageTimePerStage', () => {
    it('reflete a diferença entre entradas consecutivas de STAGE_CHANGED, excluindo a etapa atual de processo em aberto', async () => {
      const t0 = new Date('2026-01-01T00:00:00.000Z');

      // Processo concluído: Entrada por 5h, Em Andamento por 15h.
      const completedProcess = await createProcess({
        code: 'PRC-2026-D0020',
        currentStageId: stageConcluido.id,
        createdAt: t0,
        completedAt: new Date(t0.getTime() + 20 * HOUR_MS),
      });
      await createStageChange({
        processId: completedProcess.id,
        fromStageId: stageEntrada.id,
        toStageId: stageAndamento.id,
        createdAt: new Date(t0.getTime() + 5 * HOUR_MS),
      });
      await createStageChange({
        processId: completedProcess.id,
        fromStageId: stageAndamento.id,
        toStageId: stageConcluido.id,
        createdAt: new Date(t0.getTime() + 20 * HOUR_MS),
      });

      // Processo em aberto: Entrada por 8h, ainda em Em Andamento (não deve entrar na média).
      const openProcess = await createProcess({
        code: 'PRC-2026-D0021',
        currentStageId: stageAndamento.id,
        createdAt: t0,
        completedAt: null,
      });
      await createStageChange({
        processId: openProcess.id,
        fromStageId: stageEntrada.id,
        toStageId: stageAndamento.id,
        createdAt: new Date(t0.getTime() + 8 * HOUR_MS),
      });

      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const body = response.body as DashboardMetricsResponse;

      const entrada = body.averageTimePerStage.find((stage) => stage.stageId === stageEntrada.id);
      const andamento = body.averageTimePerStage.find(
        (stage) => stage.stageId === stageAndamento.id,
      );

      expect(entrada?.sampleSize).toBe(2);
      expect(entrada?.averageHours).toBeCloseTo(6.5, 1);

      // Só a transição do processo concluído (15h) conta — a etapa atual
      // do processo em aberto não entra na média.
      expect(andamento?.sampleSize).toBe(1);
      expect(andamento?.averageHours).toBeCloseTo(15, 1);
    });
  });

  describe('throughputByDay', () => {
    it('reflete created/completed por dia corretamente', async () => {
      const day1 = new Date();
      day1.setUTCHours(10, 0, 0, 0);
      const day2 = new Date(day1.getTime() - DAY_MS);

      await createProcess({
        code: 'PRC-2026-D0030',
        currentStageId: stageEntrada.id,
        createdAt: day1,
      });
      await createProcess({
        code: 'PRC-2026-D0031',
        currentStageId: stageConcluido.id,
        createdAt: day2,
        completedAt: day1,
      });

      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const body = response.body as DashboardMetricsResponse;

      const day1Key = day1.toISOString().slice(0, 10);
      const day2Key = day2.toISOString().slice(0, 10);

      const day1Entry = body.throughputByDay.find((entry) => entry.date === day1Key);
      const day2Entry = body.throughputByDay.find((entry) => entry.date === day2Key);

      expect(day1Entry?.created).toBe(1);
      expect(day1Entry?.completed).toBe(1);
      expect(day2Entry?.created).toBe(1);
      expect(day2Entry?.completed).toBe(0);
    });
  });

  describe('Filtro de organização', () => {
    it('organizationId restringe corretamente os totais', async () => {
      const otherOrganization = await prisma.organization.create({
        data: { id: 'org-other-test', name: 'Outra Org', isInternal: false },
      });
      const otherCompany = await prisma.company.create({
        data: {
          cnpj: '22333444000199',
          legalName: 'Outra Empresa',
          organizationId: otherOrganization.id,
        },
      });

      await createProcess({
        code: 'PRC-2026-D0040',
        currentStageId: stageEntrada.id,
        createdAt: new Date(),
        clientCompanyId: company.id,
      });
      await createProcess({
        code: 'PRC-2026-D0041',
        currentStageId: stageEntrada.id,
        createdAt: new Date(),
        clientCompanyId: otherCompany.id,
      });

      const response = await request(app)
        .get(`${DASHBOARD_BASE}/metrics?organizationId=${clientOrganizationId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const body = response.body as DashboardMetricsResponse;
      expect(body.totals.processes).toBe(1);
      expect(body.byOrganization.every((org) => org.organizationId === clientOrganizationId)).toBe(
        true,
      );
    });
  });
});
