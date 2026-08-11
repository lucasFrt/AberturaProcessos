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

const PROCESSES_BASE = `${env.API_PREFIX}/processes`;
const DOCUMENTS_BASE = `${env.API_PREFIX}/documents`;
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

describe('Documentos — upload, download e exclusão (integração; RF-40 a RF-44, RNF-11)', () => {
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
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await closeTestQueueProviders();
    await closeSharedRedisClient();
    await prisma.$disconnect();
    // Diretório de upload de teste é limpo ao final (docs/10, "Ambiente de teste").
    await fs.rm(path.resolve(env.STORAGE_ROOT), { recursive: true, force: true });
  });

  async function createProcess(token: string, cnpj: string): Promise<string> {
    const company = await prisma.company.create({
      data: { cnpj, legalName: 'Cliente Documentos LTDA', organizationId: clientOrganizationId },
    });
    const response = await request(app)
      .post(PROCESSES_BASE)
      .set('Authorization', `Bearer ${token}`)
      .send({ clientCompanyId: company.id, reference: 'Processo com documentos' });
    return (response.body as { id: string }).id;
  }

  it('upload de arquivo sem extensão conhecida funciona', async () => {
    const processId = await createProcess(adminToken, '11222333000181');

    const response = await request(app)
      .post(`${PROCESSES_BASE}/${processId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', Buffer.from('conteudo sem extensao'), 'arquivo-sem-extensao');

    expect(response.status).toBe(201);
    const body = response.body as { data: Array<{ originalName: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.originalName).toBe('arquivo-sem-extensao');
  });

  it('download devolve bytes idênticos e o nome original, com acentos e espaços', async () => {
    const processId = await createProcess(adminToken, '11222333000181');
    const content = Buffer.from('conteúdo com acentuação é ç ã');

    const uploadResponse = await request(app)
      .post(`${PROCESSES_BASE}/${processId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', content, 'relatório final é ótimo.pdf');

    const documentId = (uploadResponse.body as { data: Array<{ id: string }> }).data[0]?.id;

    const downloadResponse = await request(app)
      .get(`${DOCUMENTS_BASE}/${documentId}/download`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(downloadResponse.status).toBe(200);
    expect(Buffer.compare(downloadResponse.body as Buffer, content)).toBe(0);
    const disposition = downloadResponse.headers['content-disposition'] as string;
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain(encodeURIComponent('relatório final é ótimo.pdf'));
  });

  it('arquivo acima do limite responde 413 PAYLOAD_TOO_LARGE', async () => {
    const processId = await createProcess(adminToken, '11222333000181');
    const oversized = Buffer.alloc((env.MAX_UPLOAD_SIZE_MB + 1) * 1024 * 1024, 'a');

    const response = await request(app)
      .post(`${PROCESSES_BASE}/${processId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', oversized, 'grande.bin');

    expect(response.status).toBe(413);
    expect((response.body as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
  }, 30_000);

  it('CLIENT de outra organização recebe 404 no download', async () => {
    const processId = await createProcess(adminToken, '11222333000181');

    const uploadResponse = await request(app)
      .post(`${PROCESSES_BASE}/${processId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', Buffer.from('conteudo'), 'doc.pdf');
    const documentId = (uploadResponse.body as { data: Array<{ id: string }> }).data[0]?.id;

    const otherOrg = await prisma.organization.create({
      data: { name: 'Outra Org Documentos', isInternal: false },
    });
    await prisma.emailDomain.create({
      data: {
        domain: 'outraorg-teste.com.br',
        organizationId: otherOrg.id,
        defaultRole: 'CLIENT',
        autoApprove: true,
      },
    });
    const otherClientToken = await createClientAndLogin(app, 'cliente@outraorg-teste.com.br');

    const downloadResponse = await request(app)
      .get(`${DOCUMENTS_BASE}/${documentId}/download`)
      .set('Authorization', `Bearer ${otherClientToken}`);

    expect(downloadResponse.status).toBe(404);
  });

  it('CLIENT só exclui documento que ele mesmo enviou', async () => {
    const clientToken = await createClientAndLogin(app, 'cliente1@clientex-teste.com.br');
    const company = await prisma.company.create({
      data: {
        cnpj: '11222333000181',
        legalName: 'Cliente Exclusão LTDA',
        organizationId: clientOrganizationId,
      },
    });
    // accessScope ORGANIZATION por padrão no provisionamento -> já cobre a company.
    const createResponse = await request(app)
      .post(PROCESSES_BASE)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ clientCompanyId: company.id, reference: 'Processo do cliente' });
    const processId = (createResponse.body as { id: string }).id;

    // Documento enviado pelo ADMIN (usuário interno) no mesmo processo.
    const adminUploadResponse = await request(app)
      .post(`${PROCESSES_BASE}/${processId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', Buffer.from('doc do admin'), 'admin.pdf');
    const adminDocumentId = (adminUploadResponse.body as { data: Array<{ id: string }> }).data[0]
      ?.id;

    // CLIENT tenta excluir o documento do admin: 403.
    const forbiddenResponse = await request(app)
      .delete(`${DOCUMENTS_BASE}/${adminDocumentId}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(forbiddenResponse.status).toBe(403);

    // CLIENT envia o próprio documento e consegue excluí-lo.
    const clientUploadResponse = await request(app)
      .post(`${PROCESSES_BASE}/${processId}/documents`)
      .set('Authorization', `Bearer ${clientToken}`)
      .attach('files', Buffer.from('doc do cliente'), 'cliente.pdf');
    const clientDocumentId = (clientUploadResponse.body as { data: Array<{ id: string }> }).data[0]
      ?.id;

    const deleteResponse = await request(app)
      .delete(`${DOCUMENTS_BASE}/${clientDocumentId}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(deleteResponse.status).toBe(204);
  });

  it('cada upload e exclusão gera entrada no histórico do processo', async () => {
    const processId = await createProcess(adminToken, '11222333000181');

    const uploadResponse = await request(app)
      .post(`${PROCESSES_BASE}/${processId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', Buffer.from('conteudo'), 'doc.pdf');
    const documentId = (uploadResponse.body as { data: Array<{ id: string }> }).data[0]?.id;

    const deleteResponse = await request(app)
      .delete(`${DOCUMENTS_BASE}/${documentId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteResponse.status).toBe(204);

    const historyResponse = await request(app)
      .get(`${PROCESSES_BASE}/${processId}/history`)
      .set('Authorization', `Bearer ${adminToken}`);

    const historyBody = historyResponse.body as { data: Array<{ action: string }> };
    expect(historyBody.data.some((entry) => entry.action === 'DOCUMENT_ADDED')).toBe(true);
    expect(historyBody.data.some((entry) => entry.action === 'DOCUMENT_REMOVED')).toBe(true);
  });

  it('processo fora do escopo responde 404 ao listar documentos', async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: 'Outra Org Lista', isInternal: false },
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

    const listResponse = await request(app)
      .get(`${PROCESSES_BASE}/${processId}/documents`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(listResponse.status).toBe(404);
  });

  it('lista apenas documentos não excluídos (exclusão lógica)', async () => {
    const processId = await createProcess(adminToken, '11222333000181');

    const uploadResponse = await request(app)
      .post(`${PROCESSES_BASE}/${processId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', Buffer.from('conteudo'), 'doc.pdf');
    const documentId = (uploadResponse.body as { data: Array<{ id: string }> }).data[0]?.id;

    await request(app)
      .delete(`${DOCUMENTS_BASE}/${documentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const listResponse = await request(app)
      .get(`${PROCESSES_BASE}/${processId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`);

    const listBody = listResponse.body as { data: Array<{ id: string }> };
    expect(listBody.data.some((doc) => doc.id === documentId)).toBe(false);
  });
});
