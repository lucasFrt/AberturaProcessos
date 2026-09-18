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

const ORGANIZATIONS_BASE = `${env.API_PREFIX}/organizations`;
const COMPANIES_BASE = `${env.API_PREFIX}/companies`;
const USERS_BASE = `${env.API_PREFIX}/users`;
const AUTH_BASE = `${env.API_PREFIX}/auth`;

const VALID_CNPJ_1 = '11.222.333/0001-81';
const VALID_CNPJ_2 = '11.444.777/0001-61';

/**
 * Cria um ADMIN ACTIVE diretamente no banco (sem passar pelo fluxo de
 * aprovação, que é justamente o que estamos testando) e devolve o access
 * token via login (docs/05, Tarefa 7).
 */
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

async function createOperationalAndLogin(app: Express, email: string): Promise<string> {
  const registerResponse = await request(app).post(`${AUTH_BASE}/register`).send({
    name: 'Operacional Teste',
    email,
    password: 'SenhaForte1',
  });
  const body = registerResponse.body as { accessToken?: string; status: string };
  if (body.status !== 'ACTIVE' || !body.accessToken) {
    throw new Error('Setup de operacional falhou: domínio não reconhecido.');
  }
  return body.accessToken;
}

describe('Cadastros de organizações, empresas e usuários (ADMIN) — integração', () => {
  let app: Express;
  let internalOrganizationId: string;
  let clientOrganizationId: string;
  let adminToken: string;

  beforeAll(() => {
    // Limite de auth alto: cada teste faz login/registro várias vezes com o
    // mesmo IP (supertest), o que estouraria o limite padrão de 10/15min
    // (docs/06) sem que isso tenha relação com o que a Tarefa 7 testa.
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

  describe('Fluxo completo: criar org, domínio e dois CNPJs', () => {
    it('admin cria organização, adiciona domínio e dois CNPJs', async () => {
      const createOrgResponse = await request(app)
        .post(ORGANIZATIONS_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Nova Trading', isInternal: false });

      expect(createOrgResponse.status).toBe(201);
      const org = createOrgResponse.body as { id: string; name: string };
      expect(org.name).toBe('Nova Trading');

      const domainResponse = await request(app)
        .post(`${ORGANIZATIONS_BASE}/${org.id}/domains`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ domain: 'novatrading.com.br', defaultRole: 'CLIENT', autoApprove: true });

      expect(domainResponse.status).toBe(201);
      const domain = domainResponse.body as { domain: string };
      expect(domain.domain).toBe('novatrading.com.br');

      const companyOneResponse = await request(app)
        .post(COMPANIES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cnpj: VALID_CNPJ_1, legalName: 'Nova Trading Matriz', organizationId: org.id });
      expect(companyOneResponse.status).toBe(201);

      const companyTwoResponse = await request(app)
        .post(COMPANIES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cnpj: VALID_CNPJ_2, legalName: 'Nova Trading Filial', organizationId: org.id });
      expect(companyTwoResponse.status).toBe(201);

      const detailResponse = await request(app)
        .get(`${ORGANIZATIONS_BASE}/${org.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const detail = detailResponse.body as { domains: unknown[]; companies: unknown[] };
      expect(detail.domains).toHaveLength(1);
      expect(detail.companies).toHaveLength(2);
    });
  });

  describe('Domínio duplicado', () => {
    it('responde 409 CONFLICT ao cadastrar domínio já usado por outra organização', async () => {
      const orgResponse = await request(app)
        .post(ORGANIZATIONS_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Outra Org', isInternal: false });
      const org = orgResponse.body as { id: string };

      const response = await request(app)
        .post(`${ORGANIZATIONS_BASE}/${org.id}/domains`)
        .set('Authorization', `Bearer ${adminToken}`)
        // Domínio já pertence à org cliente do seedBaseline.
        .send({ domain: 'clientex-teste.com.br', defaultRole: 'CLIENT', autoApprove: true });

      expect(response.status).toBe(409);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  describe('CPF como documento da empresa (docs/13, decisão 5)', () => {
    it('cadastra pessoa física por CPF válido com documentType = CPF', async () => {
      const response = await request(app)
        .post(COMPANIES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          cnpj: '529.982.247-25',
          legalName: 'João da Silva',
          organizationId: clientOrganizationId,
        });

      expect(response.status).toBe(201);
      const body = response.body as { cnpj: string; documentType: string };
      expect(body.cnpj).toBe('52998224725');
      expect(body.documentType).toBe('CPF');
    });

    it('responde 400 INVALID_CPF para CPF com dígitos verificadores incorretos', async () => {
      const response = await request(app)
        .post(COMPANIES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cnpj: '52998224726', legalName: 'X', organizationId: clientOrganizationId });

      expect(response.status).toBe(400);
      expect((response.body as { error: { code: string } }).error.code).toBe('INVALID_CPF');
    });
  });

  describe('CNPJ inválido', () => {
    it('responde 400 INVALID_CNPJ para dígitos verificadores incorretos', async () => {
      const response = await request(app)
        .post(COMPANIES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          cnpj: '11.222.333/0001-80',
          legalName: 'Empresa Inválida',
          organizationId: clientOrganizationId,
        });

      expect(response.status).toBe(400);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_CNPJ');
    });
  });

  /**
   * A suíte roda com `CNPJ_LOOKUP_ENABLED=false` (`.env.test`) para não
   * depender de API externa (docs/09). Isso cobre justamente os caminhos que
   * não chamam o provedor: validação, escopo por papel, curto-circuito quando
   * a empresa já existe e a resposta de "consulta desligada". O caminho de
   * sucesso (dados vindos da Receita) é coberto em
   * `tests/unit/company-service.test.ts` com o fake do provider.
   */
  describe('GET /companies inclui a organização vinculada', () => {
    it('devolve organization: { id, name } em cada empresa da listagem', async () => {
      const createResponse = await request(app)
        .post(COMPANIES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          cnpj: VALID_CNPJ_1,
          legalName: 'Empresa Com Organização',
          organizationId: clientOrganizationId,
        });
      expect(createResponse.status).toBe(201);

      const listResponse = await request(app)
        .get(COMPANIES_BASE)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listResponse.status).toBe(200);
      const body = listResponse.body as {
        data: { cnpj: string; organization?: { id: string; name: string } }[];
      };
      const company = body.data.find((item) => item.cnpj === '11222333000181');
      expect(company?.organization).toEqual({
        id: clientOrganizationId,
        name: 'Cliente Teste',
      });
    });
  });

  describe('Consulta de CNPJ para autopreenchimento', () => {
    it('responde 400 INVALID_CNPJ para dígitos verificadores incorretos', async () => {
      const response = await request(app)
        .get(`${COMPANIES_BASE}/lookup/11222333000180`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_CNPJ');
    });

    it('devolve os dados do próprio banco quando o CNPJ já está cadastrado', async () => {
      const createResponse = await request(app)
        .post(COMPANIES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          cnpj: VALID_CNPJ_1,
          legalName: 'Empresa Já Cadastrada LTDA',
          tradeName: 'Já Cadastrada',
          organizationId: clientOrganizationId,
        });
      const created = createResponse.body as { id: string };

      const response = await request(app)
        .get(`${COMPANIES_BASE}/lookup/11222333000181`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const body = response.body as {
        cnpj: string;
        legalName: string;
        tradeName: string | null;
        registrationStatus: string | null;
        alreadyRegistered: boolean;
        companyId: string;
        organizationId: string;
      };
      expect(body).toEqual({
        cnpj: '11222333000181',
        legalName: 'Empresa Já Cadastrada LTDA',
        tradeName: 'Já Cadastrada',
        registrationStatus: null,
        alreadyRegistered: true,
        companyId: created.id,
        organizationId: clientOrganizationId,
      });
    });

    it('responde 503 CNPJ_LOOKUP_DISABLED quando a consulta externa está desligada', async () => {
      const response = await request(app)
        .get(`${COMPANIES_BASE}/lookup/11444777000161`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(503);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('CNPJ_LOOKUP_DISABLED');
    });

    it('responde 403 para papel não-ADMIN', async () => {
      const operationalToken = await createOperationalAndLogin(
        app,
        'operacional-lookup@opusce-teste.com.br',
      );

      const response = await request(app)
        .get(`${COMPANIES_BASE}/lookup/11444777000161`)
        .set('Authorization', `Bearer ${operationalToken}`);

      expect(response.status).toBe(403);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('responde 401 sem autenticação', async () => {
      const response = await request(app).get(`${COMPANIES_BASE}/lookup/11444777000161`);

      expect(response.status).toBe(401);
    });
  });

  describe('Exclusão com vínculo', () => {
    it('responde 409 ao excluir empresa com processo vinculado', async () => {
      const companyResponse = await request(app)
        .post(COMPANIES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          cnpj: VALID_CNPJ_1,
          legalName: 'Empresa Com Processo',
          organizationId: clientOrganizationId,
        });
      const company = companyResponse.body as { id: string };

      const stage = await prisma.kanbanStage.create({
        data: { name: 'Entrada Teste', order: 0 },
      });
      const admin = await prisma.user.findFirst({ where: { email: 'admin@opusce-teste.com.br' } });
      await prisma.process.create({
        data: {
          code: 'PRC-2026-TESTE1',
          reference: 'Processo de teste',
          clientCompanyId: company.id,
          currentStageId: stage.id,
          createdById: admin!.id,
        },
      });

      const deleteResponse = await request(app)
        .delete(`${COMPANIES_BASE}/${company.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteResponse.status).toBe(409);
      const body = deleteResponse.body as { error: { code: string } };
      expect(body.error.code).toBe('CONFLICT');
    });

    it('responde 409 ao excluir organização com usuários vinculados', async () => {
      const deleteResponse = await request(app)
        .delete(`${ORGANIZATIONS_BASE}/${internalOrganizationId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteResponse.status).toBe(409);
      const body = deleteResponse.body as { error: { code: string } };
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  describe('Aprovar usuário pendente', () => {
    it('aprova pendente e ele passa a logar', async () => {
      await request(app).post(`${AUTH_BASE}/register`).send({
        name: 'Pendente',
        email: 'pendente@dominio-desconhecido.com',
        password: 'SenhaForte1',
      });

      const listResponse = await request(app)
        .get(`${USERS_BASE}/pending`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listResponse.status).toBe(200);
      const list = listResponse.body as { data: Array<{ id: string; email: string }> };
      const pending = list.data.find((user) => user.email === 'pendente@dominio-desconhecido.com');
      expect(pending).toBeDefined();

      const approveResponse = await request(app)
        .post(`${USERS_BASE}/${pending!.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'CLIENT',
          organizationId: clientOrganizationId,
          accessScope: 'ORGANIZATION',
        });

      expect(approveResponse.status).toBe(200);
      const approved = approveResponse.body as { status: string };
      expect(approved.status).toBe('ACTIVE');

      const loginResponse = await request(app)
        .post(`${AUTH_BASE}/login`)
        .send({ email: 'pendente@dominio-desconhecido.com', password: 'SenhaForte1' });
      expect(loginResponse.status).toBe(200);
    });
  });

  describe('Guard: admin não se rebaixa nem se desativa', () => {
    it('responde 409 ao tentar rebaixar o próprio papel', async () => {
      const meResponse = await request(app)
        .get(`${AUTH_BASE}/me`)
        .set('Authorization', `Bearer ${adminToken}`);
      const me = meResponse.body as { id: string };

      const response = await request(app)
        .patch(`${USERS_BASE}/${me.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'CLIENT' });

      expect(response.status).toBe(409);
    });

    it('responde 409 ao tentar se desativar', async () => {
      const meResponse = await request(app)
        .get(`${AUTH_BASE}/me`)
        .set('Authorization', `Bearer ${adminToken}`);
      const me = meResponse.body as { id: string };

      const response = await request(app)
        .patch(`${USERS_BASE}/${me.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'DISABLED' });

      expect(response.status).toBe(409);
    });
  });

  describe('Autorização por papel', () => {
    it('CLIENT recebe 403 em /organizations, /companies e /users', async () => {
      const clientToken = await createClientAndLogin(app, 'cliente1@clientex-teste.com.br');

      const orgResponse = await request(app)
        .get(ORGANIZATIONS_BASE)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(orgResponse.status).toBe(403);

      const companiesResponse = await request(app)
        .get(COMPANIES_BASE)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(companiesResponse.status).toBe(403);

      const usersResponse = await request(app)
        .get(USERS_BASE)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(usersResponse.status).toBe(403);
    });

    it('OPERATIONAL recebe 403 em /organizations, /companies e /users, mas acessa /users/operational', async () => {
      const operationalToken = await createOperationalAndLogin(
        app,
        'operacional1@opusce-teste.com.br',
      );

      const orgResponse = await request(app)
        .get(ORGANIZATIONS_BASE)
        .set('Authorization', `Bearer ${operationalToken}`);
      expect(orgResponse.status).toBe(403);

      const usersResponse = await request(app)
        .get(USERS_BASE)
        .set('Authorization', `Bearer ${operationalToken}`);
      expect(usersResponse.status).toBe(403);

      const operationalResponse = await request(app)
        .get(`${USERS_BASE}/operational`)
        .set('Authorization', `Bearer ${operationalToken}`);
      expect(operationalResponse.status).toBe(200);
    });

    it('ADMIN acessa /users/operational normalmente', async () => {
      const response = await request(app)
        .get(`${USERS_BASE}/operational`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(200);
      const body = response.body as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});
