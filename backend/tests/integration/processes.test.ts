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

const PROCESSES_BASE = `${env.API_PREFIX}/processes`;
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

describe('Processos — criação e listagem com escopo (integração)', () => {
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

    await request(app)
      .post(STAGES_BASE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Entrada' });
    await request(app)
      .post(STAGES_BASE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Em Andamento' });
    await request(app)
      .post(STAGES_BASE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Concluído', isFinal: true });
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await closeTestQueueProviders();
    await closeSharedRedisClient();
    await prisma.$disconnect();
  });

  describe('Criação e código sequencial', () => {
    it('criar processo devolve PRC-{ano}-00001 e o próximo é 00002', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Teste LTDA',
          organizationId: clientOrganizationId,
        },
      });

      const year = new Date().getFullYear();

      const first = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Primeiro processo' });
      expect(first.status).toBe(201);
      expect((first.body as { code: string }).code).toBe(`PRC-${year}-00001`);

      const second = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Segundo processo' });
      expect(second.status).toBe(201);
      expect((second.body as { code: string }).code).toBe(`PRC-${year}-00002`);
    });

    it('posiciona o processo criado na etapa de menor order', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Teste LTDA',
          organizationId: clientOrganizationId,
        },
      });

      const response = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Processo novo' });

      const firstStage = await prisma.kanbanStage.findFirst({ orderBy: { order: 'asc' } });
      expect((response.body as { currentStage: { id: string } }).currentStage.id).toBe(
        firstStage!.id,
      );
    });
  });

  describe('Escopo — CLIENT só vê processos dos seus CNPJs', () => {
    it('dois clientes de organizações diferentes só veem os próprios processos', async () => {
      // Segunda organização cliente, com domínio próprio.
      const otherOrg = await prisma.organization.create({
        data: { id: 'org-client-2-test', name: 'Cliente Dois', isInternal: false },
      });
      await prisma.emailDomain.create({
        data: {
          domain: 'clientedois-teste.com.br',
          organizationId: otherOrg.id,
          defaultRole: 'CLIENT',
          autoApprove: true,
        },
      });

      const companyOne = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Um LTDA',
          organizationId: clientOrganizationId,
        },
      });
      const companyTwo = await prisma.company.create({
        data: {
          cnpj: '11444777000161',
          legalName: 'Cliente Dois LTDA',
          organizationId: otherOrg.id,
        },
      });

      const clientOneToken = await createClientAndLogin(app, 'cliente1@clientex-teste.com.br');
      const clientTwoToken = await createClientAndLogin(app, 'cliente2@clientedois-teste.com.br');

      const createOne = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${clientOneToken}`)
        .send({ clientCompanyId: companyOne.id, reference: 'Processo do cliente um' });
      expect(createOne.status).toBe(201);

      const createTwo = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${clientTwoToken}`)
        .send({ clientCompanyId: companyTwo.id, reference: 'Processo do cliente dois' });
      expect(createTwo.status).toBe(201);

      const listOne = await request(app)
        .get(PROCESSES_BASE)
        .set('Authorization', `Bearer ${clientOneToken}`);
      const bodyOne = listOne.body as { data: Array<{ id: string }> };
      expect(bodyOne.data).toHaveLength(1);
      expect(bodyOne.data[0]?.id).toBe((createOne.body as { id: string }).id);

      const listTwo = await request(app)
        .get(PROCESSES_BASE)
        .set('Authorization', `Bearer ${clientTwoToken}`);
      const bodyTwo = listTwo.body as { data: Array<{ id: string }> };
      expect(bodyTwo.data).toHaveLength(1);
      expect(bodyTwo.data[0]?.id).toBe((createTwo.body as { id: string }).id);
    });

    it('CLIENT alcança processo em que sua empresa é apenas requestingCompany', async () => {
      const clientCompany = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Final LTDA',
          organizationId: clientOrganizationId,
        },
      });
      const requestingCompany = await prisma.company.create({
        data: {
          cnpj: '11444777000161',
          legalName: 'Solicitante LTDA',
          organizationId: clientOrganizationId,
        },
      });

      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientCompanyId: clientCompany.id,
          requestingCompanyId: requestingCompany.id,
          reference: 'Processo com solicitante',
        });
      const processId = (createResponse.body as { id: string }).id;

      // Cria um usuário CLIENT com accessScope = COMPANIES restrito ao
      // CNPJ solicitante, para provar que o acesso via requestingCompany
      // funciona mesmo sem acesso ao clientCompany.
      const requestingOnlyUser = await prisma.user.create({
        data: {
          name: 'Usuário Solicitante',
          email: 'solicitante@clientex-teste.com.br',
          passwordHash: await new BcryptPasswordHasher().hash('SenhaForte1'),
          role: 'CLIENT',
          status: 'ACTIVE',
          accessScope: 'COMPANIES',
          organizationId: clientOrganizationId,
        },
      });
      await prisma.userCompany.create({
        data: { userId: requestingOnlyUser.id, companyId: requestingCompany.id },
      });

      const loginResponse = await request(app)
        .post(`${AUTH_BASE}/login`)
        .send({ email: 'solicitante@clientex-teste.com.br', password: 'SenhaForte1' });
      const token = (loginResponse.body as { accessToken: string }).accessToken;

      const detailResponse = await request(app)
        .get(`${PROCESSES_BASE}/${processId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(detailResponse.status).toBe(200);
      expect((detailResponse.body as { id: string }).id).toBe(processId);
    });

    it('detalhe de processo de outra organização responde 404, não 403', async () => {
      const otherOrg = await prisma.organization.create({
        data: { id: 'org-other-test', name: 'Outra Org', isInternal: false },
      });
      const otherCompany = await prisma.company.create({
        data: { cnpj: '11444777000161', legalName: 'Outra Empresa', organizationId: otherOrg.id },
      });

      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: otherCompany.id, reference: 'Processo de outra org' });
      const processId = (createResponse.body as { id: string }).id;

      const clientToken = await createClientAndLogin(app, 'cliente1@clientex-teste.com.br');

      const detailResponse = await request(app)
        .get(`${PROCESSES_BASE}/${processId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(detailResponse.status).toBe(404);
    });

    it('CLIENT não consegue criar processo para CNPJ fora do escopo', async () => {
      const outOfScopeOrg = await prisma.organization.create({
        data: { name: 'Fora do Escopo', isInternal: false },
      });
      const outOfScopeCompany = await prisma.company.create({
        data: {
          cnpj: '11444777000161',
          legalName: 'Fora do Escopo LTDA',
          organizationId: outOfScopeOrg.id,
        },
      });

      const clientToken = await createClientAndLogin(app, 'cliente1@clientex-teste.com.br');

      const response = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ clientCompanyId: outOfScopeCompany.id, reference: 'Tentativa fora do escopo' });

      expect(response.status).toBe(403);
    });
  });

  describe('Board', () => {
    it('devolve etapas com total e processos limitados por limitPerStage', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Board LTDA',
          organizationId: clientOrganizationId,
        },
      });

      for (let i = 0; i < 3; i += 1) {
        await request(app)
          .post(PROCESSES_BASE)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ clientCompanyId: company.id, reference: `Processo board ${i}` });
      }

      const boardResponse = await request(app)
        .get(`${PROCESSES_BASE}/board?limitPerStage=2`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(boardResponse.status).toBe(200);
      const body = boardResponse.body as {
        stages: Array<{ name: string; total: number; processes: unknown[] }>;
      };
      const entradaStage = body.stages.find((stage) => stage.name === 'Entrada');
      expect(entradaStage?.total).toBe(3);
      expect(entradaStage?.processes).toHaveLength(2);
    });
  });

  describe('Edição', () => {
    it('gera histórico PROCESS_UPDATED com o diff', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Edição LTDA',
          organizationId: clientOrganizationId,
        },
      });

      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Referência original' });
      const processId = (createResponse.body as { id: string }).id;

      const updateResponse = await request(app)
        .patch(`${PROCESSES_BASE}/${processId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reference: 'Referência atualizada' });

      expect(updateResponse.status).toBe(200);
      const body = updateResponse.body as {
        reference: string;
        history: Array<{ action: string }>;
      };
      expect(body.reference).toBe('Referência atualizada');
      expect(body.history.some((entry) => entry.action === 'PROCESS_UPDATED')).toBe(true);
    });
  });

  describe('PATCH /processes/:id/stage — movimentação (RF-25, RF-27; docs/12 Tarefa 10)', () => {
    it('mover gera STAGE_CHANGED com origem, destino, autor e timestamp', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Movimentação LTDA',
          organizationId: clientOrganizationId,
        },
      });
      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Processo a mover' });
      const processId = (createResponse.body as { id: string }).id;
      const andamentoStage = await prisma.kanbanStage.findFirst({
        where: { name: 'Em Andamento' },
      });

      const moveResponse = await request(app)
        .patch(`${PROCESSES_BASE}/${processId}/stage`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toStageId: andamentoStage!.id, note: 'Documentação liberada.' });

      expect(moveResponse.status).toBe(200);
      const body = moveResponse.body as {
        currentStage: { id: string };
        history: Array<{
          action: string;
          fromStage: { name: string } | null;
          toStage: { name: string } | null;
          actor: { id: string };
          createdAt: string;
        }>;
      };
      expect(body.currentStage.id).toBe(andamentoStage!.id);
      const entry = body.history.find((h) => h.action === 'STAGE_CHANGED');
      expect(entry).toBeDefined();
      expect(entry?.fromStage?.name).toBe('Entrada');
      expect(entry?.toStage?.name).toBe('Em Andamento');
      expect(entry?.actor.id).toBeDefined();
      expect(entry?.createdAt).toBeDefined();
    });

    it('entrar em etapa final grava completedAt; sair limpa completedAt', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Conclusão LTDA',
          organizationId: clientOrganizationId,
        },
      });
      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Processo a concluir' });
      const processId = (createResponse.body as { id: string }).id;
      const andamentoStage = await prisma.kanbanStage.findFirst({
        where: { name: 'Em Andamento' },
      });
      const finalStage = await prisma.kanbanStage.findFirst({ where: { name: 'Concluído' } });

      const completeResponse = await request(app)
        .patch(`${PROCESSES_BASE}/${processId}/stage`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toStageId: finalStage!.id });
      expect((completeResponse.body as { completedAt: string | null }).completedAt).not.toBeNull();

      const reopenResponse = await request(app)
        .patch(`${PROCESSES_BASE}/${processId}/stage`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toStageId: andamentoStage!.id });
      expect((reopenResponse.body as { completedAt: string | null }).completedAt).toBeNull();
    });

    it('CLIENT recebe 403 ao mover', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Restrito LTDA',
          organizationId: clientOrganizationId,
        },
      });
      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Processo restrito' });
      const processId = (createResponse.body as { id: string }).id;
      const andamentoStage = await prisma.kanbanStage.findFirst({
        where: { name: 'Em Andamento' },
      });

      const clientToken = await createClientAndLogin(app, 'cliente1@clientex-teste.com.br');

      const moveResponse = await request(app)
        .patch(`${PROCESSES_BASE}/${processId}/stage`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ toStageId: andamentoStage!.id });

      expect(moveResponse.status).toBe(403);
    });

    it('mover para a etapa atual responde 409 CONFLICT', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Conflito LTDA',
          organizationId: clientOrganizationId,
        },
      });
      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Processo conflito' });
      const processId = (createResponse.body as { id: string }).id;
      const entradaStage = await prisma.kanbanStage.findFirst({ where: { name: 'Entrada' } });

      const moveResponse = await request(app)
        .patch(`${PROCESSES_BASE}/${processId}/stage`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toStageId: entradaStage!.id });

      expect(moveResponse.status).toBe(409);
    });
  });

  describe('PATCH /processes/:id/responsible (RF-26; docs/12 Tarefa 10)', () => {
    it('atribui usuário interno ativo como responsável', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Responsável LTDA',
          organizationId: clientOrganizationId,
        },
      });
      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Processo com responsável' });
      const processId = (createResponse.body as { id: string }).id;

      const operational = await prisma.user.create({
        data: {
          name: 'Carlos Souza',
          email: 'carlos@opusce-teste.com.br',
          role: 'OPERATIONAL',
          status: 'ACTIVE',
          accessScope: 'ORGANIZATION',
          organizationId: internalOrganizationId,
        },
      });

      const response = await request(app)
        .patch(`${PROCESSES_BASE}/${processId}/responsible`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ responsibleId: operational.id });

      expect(response.status).toBe(200);
      const body = response.body as {
        responsible: { id: string } | null;
        history: Array<{ action: string }>;
      };
      expect(body.responsible?.id).toBe(operational.id);
      expect(body.history.some((h) => h.action === 'RESPONSIBLE_CHANGED')).toBe(true);
    });

    it('atribuir CLIENT como responsável responde 400', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Inválido LTDA',
          organizationId: clientOrganizationId,
        },
      });
      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Processo' });
      const processId = (createResponse.body as { id: string }).id;

      const clientUser = await prisma.user.create({
        data: {
          name: 'Cliente Qualquer',
          email: 'clientequalquer@clientex-teste.com.br',
          role: 'CLIENT',
          status: 'ACTIVE',
          accessScope: 'ORGANIZATION',
          organizationId: clientOrganizationId,
        },
      });

      const response = await request(app)
        .patch(`${PROCESSES_BASE}/${processId}/responsible`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ responsibleId: clientUser.id });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /processes/:id (RF-28, RF-29; docs/12 Tarefa 10)', () => {
    it('processo excluído desaparece de listagem e board mas o histórico permanece consultável', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Exclusão LTDA',
          organizationId: clientOrganizationId,
        },
      });
      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Processo a excluir' });
      const processId = (createResponse.body as { id: string }).id;

      const deleteResponse = await request(app)
        .delete(`${PROCESSES_BASE}/${processId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteResponse.status).toBe(204);

      const listResponse = await request(app)
        .get(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`);
      const listBody = listResponse.body as { data: Array<{ id: string }> };
      expect(listBody.data.some((item) => item.id === processId)).toBe(false);

      const boardResponse = await request(app)
        .get(`${PROCESSES_BASE}/board`)
        .set('Authorization', `Bearer ${adminToken}`);
      const boardBody = boardResponse.body as {
        stages: Array<{ processes: Array<{ id: string }> }>;
      };
      const stillOnBoard = boardBody.stages.some((stage) =>
        stage.processes.some((p) => p.id === processId),
      );
      expect(stillOnBoard).toBe(false);

      const historyResponse = await request(app)
        .get(`${PROCESSES_BASE}/${processId}/history`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(historyResponse.status).toBe(200);
      const historyBody = historyResponse.body as { data: Array<{ action: string }> };
      expect(historyBody.data.some((entry) => entry.action === 'PROCESS_DELETED')).toBe(true);
    });

    it('CLIENT recebe 403 ao excluir', async () => {
      const company = await prisma.company.create({
        data: {
          cnpj: '11222333000181',
          legalName: 'Cliente Restrito Exclusão LTDA',
          organizationId: clientOrganizationId,
        },
      });
      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference: 'Processo' });
      const processId = (createResponse.body as { id: string }).id;

      const clientToken = await createClientAndLogin(app, 'cliente1@clientex-teste.com.br');

      const deleteResponse = await request(app)
        .delete(`${PROCESSES_BASE}/${processId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(deleteResponse.status).toBe(403);
    });
  });

  describe('GET /processes/:id/history (RF-29; docs/12 Tarefa 10)', () => {
    it('processo de outro escopo responde 404 no histórico', async () => {
      const otherOrg = await prisma.organization.create({
        data: { name: 'Outra Org Histórico', isInternal: false },
      });
      const otherCompany = await prisma.company.create({
        data: { cnpj: '11444777000161', legalName: 'Outra Empresa', organizationId: otherOrg.id },
      });

      const createResponse = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: otherCompany.id, reference: 'Processo de outra org' });
      const processId = (createResponse.body as { id: string }).id;

      const clientToken = await createClientAndLogin(app, 'cliente1@clientex-teste.com.br');

      const historyResponse = await request(app)
        .get(`${PROCESSES_BASE}/${processId}/history`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(historyResponse.status).toBe(404);
    });
  });
});
