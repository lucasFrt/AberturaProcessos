import { promises as fs } from 'node:fs';
import path from 'node:path';

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

const API_KEYS_BASE = `${env.API_PREFIX}/api-keys`;
const PROCESSES_BASE = `${env.API_PREFIX}/processes`;
const AUTH_BASE = `${env.API_PREFIX}/auth`;

async function createUser(
  client: PrismaClient,
  organizationId: string,
  email: string,
  role: 'ADMIN' | 'OPERATIONAL' | 'CLIENT',
): Promise<string> {
  const passwordHasher = new BcryptPasswordHasher();
  const passwordHash = await passwordHasher.hash('SenhaForte1');
  const user = await client.user.create({
    data: {
      name: `Usuário ${role}`,
      email,
      passwordHash,
      role,
      status: 'ACTIVE',
      accessScope: 'ORGANIZATION',
      organizationId,
    },
  });
  return user.id;
}

async function login(app: Express, email: string): Promise<string> {
  const response = await request(app)
    .post(`${AUTH_BASE}/login`)
    .send({ email, password: 'SenhaForte1' });
  return (response.body as { accessToken: string }).accessToken;
}

interface CreatedApiKeyBody {
  id: string;
  key: string;
  keyPrefix: string;
  user: { id: string; role: string };
  revokedAt: string | null;
}

/**
 * Tarefa 23 (docs/12): chaves de API para contas de serviço. Cobre a
 * emissão única do segredo, o uso da chave numa rota comum (`GET
 * /processes`), a revogação e as guardas de papel.
 */
describe('Chaves de API — integração (docs/13, decisão 2)', () => {
  let app: Express;
  let internalOrganizationId: string;
  let adminToken: string;
  let operationalUserId: string;

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
    await createUser(prisma, internalOrganizationId, 'admin@opusce-teste.com.br', 'ADMIN');
    adminToken = await login(app, 'admin@opusce-teste.com.br');
    operationalUserId = await createUser(
      prisma,
      internalOrganizationId,
      'agente@opusce-teste.com.br',
      'OPERATIONAL',
    );
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await closeTestQueueProviders();
    await closeSharedRedisClient();
    await prisma.$disconnect();
    await fs.rm(path.resolve(env.STORAGE_ROOT), { recursive: true, force: true });
  });

  async function createApiKey(userId: string): Promise<CreatedApiKeyBody> {
    const response = await request(app)
      .post(API_KEYS_BASE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Agente de E-mail', userId });
    expect(response.status).toBe(201);
    return response.body as CreatedApiKeyBody;
  }

  it('ADMIN cria chave e recebe o segredo uma única vez; a listagem só mostra o prefixo', async () => {
    const created = await createApiKey(operationalUserId);

    expect(created.key.startsWith('apk_')).toBe(true);
    expect(created.keyPrefix).toBe(created.key.slice(0, 12));
    expect(created.user.id).toBe(operationalUserId);

    const list = await request(app).get(API_KEYS_BASE).set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const body = list.body as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty('key');
    expect(body.data[0]).not.toHaveProperty('keyHash');
    expect(body.data[0]?.keyPrefix).toBe(created.keyPrefix);

    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.keyHash).not.toBe(created.key);
  });

  it('a chave autentica uma rota comum como o usuário vinculado e registra lastUsedAt', async () => {
    const created = await createApiKey(operationalUserId);

    const response = await request(app).get(PROCESSES_BASE).set('X-Api-Key', created.key);

    expect(response.status).toBe(200);

    const me = await request(app).get(`${AUTH_BASE}/me`).set('X-Api-Key', created.key);
    expect(me.status).toBe(200);
    expect((me.body as { id: string }).id).toBe(operationalUserId);

    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.lastUsedAt).not.toBeNull();
  });

  it('processo e documento criados com a chave ficam com source = API (docs/13, decisão 7)', async () => {
    const created = await createApiKey(operationalUserId);
    await prisma.kanbanStage.create({ data: { name: 'Entrada', order: 0 } });
    const company = await prisma.company.create({
      data: {
        cnpj: '11222333000181',
        legalName: 'Cliente LTDA',
        organizationId: 'org-client-test',
      },
    });

    const processResponse = await request(app)
      .post(PROCESSES_BASE)
      .set('X-Api-Key', created.key)
      .send({ clientCompanyId: company.id, reference: 'Via chave de API' });

    expect(processResponse.status).toBe(201);
    const process = processResponse.body as {
      id: string;
      source: string;
      createdBy: { id: string };
      requesterEmail: string | null;
    };
    expect(process.source).toBe('API');
    expect(process.createdBy.id).toBe(operationalUserId);
    expect(process.requesterEmail).toBeNull();

    const uploadResponse = await request(app)
      .post(`${PROCESSES_BASE}/${process.id}/documents`)
      .set('X-Api-Key', created.key)
      .attach('files', Buffer.from('conteudo'), 'invoice.pdf');

    expect(uploadResponse.status).toBe(201);
    const upload = uploadResponse.body as {
      data: Array<{ source: string; receivedAt: string | null }>;
    };
    expect(upload.data[0]?.source).toBe('API');
    expect(upload.data[0]?.receivedAt).toBeNull();

    // Pelo formulário (JWT) a origem é WEB.
    const webResponse = await request(app)
      .post(PROCESSES_BASE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientCompanyId: company.id, reference: 'Via formulário' });
    expect((webResponse.body as { source: string }).source).toBe('WEB');
  });

  it('chave inexistente ou ausente responde 401', async () => {
    const wrong = await request(app).get(PROCESSES_BASE).set('X-Api-Key', 'apk_nao-existe');
    expect(wrong.status).toBe(401);

    const missing = await request(app).get(PROCESSES_BASE);
    expect(missing.status).toBe(401);
  });

  it('chave revogada responde 401 imediatamente', async () => {
    const created = await createApiKey(operationalUserId);

    const revoke = await request(app)
      .delete(`${API_KEYS_BASE}/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revoke.status).toBe(204);

    const response = await request(app).get(PROCESSES_BASE).set('X-Api-Key', created.key);
    expect(response.status).toBe(401);

    const list = await request(app).get(API_KEYS_BASE).set('Authorization', `Bearer ${adminToken}`);
    const body = list.body as { data: Array<{ id: string; revokedAt: string | null }> };
    expect(body.data.find((key) => key.id === created.id)?.revokedAt).not.toBeNull();
  });

  it('desativar o usuário vinculado corta a chave com 403 ACCOUNT_DISABLED', async () => {
    const created = await createApiKey(operationalUserId);
    await prisma.user.update({ where: { id: operationalUserId }, data: { status: 'DISABLED' } });

    const response = await request(app).get(PROCESSES_BASE).set('X-Api-Key', created.key);

    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });

  it('a chave herda o papel do usuário: OPERATIONAL não acessa rotas de ADMIN', async () => {
    const created = await createApiKey(operationalUserId);

    const response = await request(app).get(API_KEYS_BASE).set('X-Api-Key', created.key);

    expect(response.status).toBe(403);
  });

  it('chave para usuário CLIENT é recusada com 400', async () => {
    const clientUserId = await createUser(
      prisma,
      'org-client-test',
      'cliente@clientex-teste.com.br',
      'CLIENT',
    );

    const response = await request(app)
      .post(API_KEYS_BASE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Indevida', userId: clientUserId });

    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('OPERATIONAL (por JWT) recebe 403 nas rotas de chaves', async () => {
    const operationalToken = await login(app, 'agente@opusce-teste.com.br');

    const response = await request(app)
      .post(API_KEYS_BASE)
      .set('Authorization', `Bearer ${operationalToken}`)
      .send({ name: 'Tentativa', userId: operationalUserId });

    expect(response.status).toBe(403);
  });
});
