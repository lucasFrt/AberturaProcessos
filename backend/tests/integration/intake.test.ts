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

const INTAKE_BASE = `${env.API_PREFIX}/intake`;
const API_KEYS_BASE = `${env.API_PREFIX}/api-keys`;
const PROCESSES_BASE = `${env.API_PREFIX}/processes`;
const AUTH_BASE = `${env.API_PREFIX}/auth`;

const VALID_CNPJ = '11222333000181';
const NEW_CNPJ = '05557450000608';

async function createUser(
  client: PrismaClient,
  organizationId: string,
  email: string,
  role: 'ADMIN' | 'OPERATIONAL' | 'CLIENT',
): Promise<string> {
  const passwordHash = await new BcryptPasswordHasher().hash('SenhaForte1');
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

interface IntakeResultBody {
  duplicate: boolean;
  event: { id: string; status: string; kind: string; processId: string | null };
  process: {
    id: string;
    code: string;
    reference: string;
    source: string;
    requesterName: string | null;
    requesterEmail: string | null;
    receivedAt: string | null;
    additionalInfo: string | null;
    clientCompany: { id: string; cnpj: string; legalName: string };
    documents: Array<{
      id: string;
      originalName: string;
      source: string;
      receivedAt: string | null;
    }>;
    history: Array<{ action: string }>;
  };
  documents: Array<{ id: string; originalName: string; receivedAt: string | null }>;
  company: { id: string; created: boolean } | null;
  organization: { id: string; created: boolean; domainRegistered: boolean } | null;
  warnings: string[];
}

interface ErrorBody {
  error: { code: string; details?: { candidates?: unknown[] } };
}

function basePayload(externalId: string): Record<string, unknown> {
  return {
    source: {
      channel: 'EMAIL',
      externalId,
      subject: 'Abertura de processo',
      receivedAt: '2026-09-18T10:32:00.000Z',
    },
    requester: { email: 'joao@clientex-teste.com.br', name: 'João' },
    company: { document: '11.222.333/0001-81', name: 'Cliente Teste LTDA' },
    reference: 'IMP-2026-0042',
    additionalInfo: 'Carga com LI pendente.',
  };
}

/**
 * Tarefa 25 (docs/12; docs/13): intake por e-mail via chave de API. Roda
 * com CNPJ_LOOKUP_ENABLED=false e GRAPH_INTAKE_ENABLED ausente (docs/10,
 * `.env.test`), então nenhum teste aqui toca a rede: a razão social vem do
 * payload e os anexos vêm do multipart.
 */
describe('Intake por e-mail — integração (docs/13)', () => {
  let app: Express;
  let adminToken: string;
  let apiKey: string;
  let agentUserId: string;

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
    await createUser(prisma, baseline.internalOrganizationId, 'admin@opusce-teste.com.br', 'ADMIN');
    adminToken = await login(app, 'admin@opusce-teste.com.br');
    agentUserId = await createUser(
      prisma,
      baseline.internalOrganizationId,
      'agente@opusce-teste.com.br',
      'OPERATIONAL',
    );
    const created = await request(app)
      .post(API_KEYS_BASE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Agente', userId: agentUserId });
    apiKey = (created.body as { key: string }).key;

    await prisma.kanbanStage.create({ data: { name: 'Entrada', order: 0 } });
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await closeTestQueueProviders();
    await closeSharedRedisClient();
    await prisma.$disconnect();
    await fs.rm(path.resolve(env.STORAGE_ROOT), { recursive: true, force: true });
  });

  describe('POST /intake/processes', () => {
    it('e-mail com CNPJ conhecido cria processo EMAIL com solicitante, receivedAt e anexos do multipart', async () => {
      await prisma.company.create({
        data: {
          cnpj: VALID_CNPJ,
          legalName: 'Cliente Teste LTDA',
          organizationId: 'org-client-test',
        },
      });

      const response = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .field('payload', JSON.stringify(basePayload('msg-001')))
        .attach('files', Buffer.from('invoice'), 'invoice.pdf')
        .attach('files', Buffer.from('packing'), 'packing-list.pdf');

      expect(response.status).toBe(201);
      const body = response.body as IntakeResultBody;
      expect(body.duplicate).toBe(false);
      expect(body.event.status).toBe('COMPLETED');
      expect(body.event.kind).toBe('PROCESS');
      expect(body.process.source).toBe('EMAIL');
      expect(body.process.requesterEmail).toBe('joao@clientex-teste.com.br');
      expect(body.process.requesterName).toBe('João');
      expect(body.process.receivedAt).toBe('2026-09-18T10:32:00.000Z');
      expect(body.process.clientCompany.cnpj).toBe(VALID_CNPJ);
      expect(body.company).toEqual({ id: body.process.clientCompany.id, created: false });
      expect(body.documents.map((d) => d.originalName).sort()).toEqual([
        'invoice.pdf',
        'packing-list.pdf',
      ]);
      expect(body.documents[0]?.receivedAt).toBe('2026-09-18T10:32:00.000Z');
      expect(body.process.documents.every((d) => d.source === 'EMAIL')).toBe(true);
      // Autoria: o usuário vinculado à chave.
      const stored = await prisma.process.findUniqueOrThrow({ where: { id: body.process.id } });
      expect(stored.createdById).toBe(agentUserId);
    });

    it('CNPJ desconhecido com domínio desconhecido cadastra organização, domínio (sem auto-aprovação) e empresa', async () => {
      const payload = {
        ...basePayload('msg-002'),
        requester: { email: 'maria@novaempresa.com.br', name: 'Maria' },
        company: { document: NEW_CNPJ, name: 'Nova Empresa Importadora' },
      };

      const response = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .send(payload);

      expect(response.status).toBe(201);
      const body = response.body as IntakeResultBody;
      expect(body.company?.created).toBe(true);
      expect(body.organization?.created).toBe(true);
      expect(body.organization?.domainRegistered).toBe(true);
      // Consulta à Receita desligada na suíte: nome veio do e-mail.
      expect(body.process.clientCompany.legalName).toBe('Nova Empresa Importadora');
      expect(body.warnings.length).toBeGreaterThan(0);

      const domain = await prisma.emailDomain.findUniqueOrThrow({
        where: { domain: 'novaempresa.com.br' },
      });
      expect(domain.autoApprove).toBe(false);
      expect(domain.defaultRole).toBe('CLIENT');
      expect(domain.organizationId).toBe(body.organization?.id);

      // Quem se registrar por esse domínio entra PENDING (docs/13, decisão 5).
      const register = await request(app)
        .post(`${AUTH_BASE}/register`)
        .send({ name: 'Outro', email: 'outro@novaempresa.com.br', password: 'SenhaForte1' });
      expect(register.status).toBe(202);
    });

    it('mesmo externalId responde 200 duplicate: true sem criar processo nem documentos', async () => {
      const first = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .field('payload', JSON.stringify(basePayload('msg-003')))
        .attach('files', Buffer.from('x'), 'a.pdf');
      expect(first.status).toBe(201);

      const second = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .field('payload', JSON.stringify(basePayload('msg-003')))
        .attach('files', Buffer.from('x'), 'a.pdf');

      expect(second.status).toBe(200);
      const body = second.body as IntakeResultBody;
      expect(body.duplicate).toBe(true);
      expect(body.process.id).toBe((first.body as IntakeResultBody).process.id);
      expect(body.documents).toHaveLength(1);
      expect(await prisma.process.count()).toBe(1);
      expect(await prisma.document.count()).toBe(1);
      expect(await prisma.intakeEvent.count()).toBe(1);
    });

    it('fetchAttachments com Graph desligado responde 503 MAIL_ATTACHMENTS_DISABLED e nada é criado', async () => {
      const response = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .send({ ...basePayload('msg-004'), fetchAttachments: true });

      expect(response.status).toBe(503);
      expect((response.body as ErrorBody).error.code).toBe('MAIL_ATTACHMENTS_DISABLED');
      expect(await prisma.process.count()).toBe(0);
      const event = await prisma.intakeEvent.findFirstOrThrow();
      expect(event.status).toBe('FAILED');
    });

    it('multipart sem o campo payload responde 400', async () => {
      const response = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .attach('files', Buffer.from('x'), 'a.pdf');

      expect(response.status).toBe(400);
      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('internetMessageId: id do Graph novo para a mesma mensagem responde duplicate (docs/14)', async () => {
      const withMessageId = (externalId: string): Record<string, unknown> => ({
        ...basePayload(externalId),
        source: {
          channel: 'EMAIL',
          externalId,
          internetMessageId: '<msg-006@mail.example>',
          receivedAt: '2026-09-18T10:32:00.000Z',
        },
      });
      const first = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .send(withMessageId('id-antes-de-mover'));
      expect(first.status).toBe(201);

      const second = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .send(withMessageId('id-depois-de-mover'));

      expect(second.status).toBe(200);
      expect((second.body as IntakeResultBody).duplicate).toBe(true);
      expect(await prisma.process.count()).toBe(1);

      const events = await request(app)
        .get(`${INTAKE_BASE}/events`)
        .set('X-Api-Key', apiKey)
        .query({ internetMessageId: '<msg-006@mail.example>' });
      const list = events.body as {
        data: Array<{ externalId: string; internetMessageId: string }>;
      };
      expect(list.data).toHaveLength(1);
      expect(list.data[0]?.internetMessageId).toBe('<msg-006@mail.example>');
    });

    it('sem company.document, a empresa vem do domínio do solicitante; sem empresa cadastrada nasce em cadastro pendente', async () => {
      const webmail = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .send({
          ...basePayload('msg-dom-0'),
          requester: { email: 'alguem@gmail.com' },
          company: null,
        });
      expect(webmail.status).toBe(400);
      expect((webmail.body as ErrorBody).error.code).toBe('COMPANY_REQUIRED');

      // Domínio corporativo novo: organização + domínio + empresa pendente (docs/13, decisão 10).
      const pending = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .send({
          ...basePayload('msg-dom-1'),
          requester: { email: 'importacao@casaenovidade.com.br', name: 'Gabriel' },
          company: { document: null, name: 'Casa & Novidade' },
        });
      expect(pending.status).toBe(201);
      const pendingBody = pending.body as IntakeResultBody;
      expect(pendingBody.process.clientCompany.cnpj).toBeNull();
      expect(pendingBody.process.clientCompany.legalName).toBe('Casa & Novidade');
      expect(pendingBody.company?.created).toBe(true);
      expect(pendingBody.organization).toMatchObject({ created: true, domainRegistered: true });

      // Duas pendentes ao mesmo tempo: o índice único é filtrado (docs/04).
      const pending2 = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .send({
          ...basePayload('msg-dom-1b'),
          requester: { email: 'larissa@seanite.com' },
          company: null,
        });
      expect(pending2.status).toBe(201);
      expect(await prisma.company.count({ where: { cnpj: null } })).toBe(2);

      await prisma.company.create({
        data: {
          cnpj: VALID_CNPJ,
          legalName: 'Cliente Teste LTDA',
          organizationId: 'org-client-test',
        },
      });
      const resolved = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .send({ ...basePayload('msg-dom-2'), company: { document: null, name: 'Cliente Teste' } });
      expect(resolved.status).toBe(201);
      const body = resolved.body as IntakeResultBody;
      expect(body.process.clientCompany.cnpj).toBe(VALID_CNPJ);
      expect(body.company?.created).toBe(false);
      expect(body.warnings.some((w) => w.includes('resolvida pelo domínio'))).toBe(true);

      // Lista de pendências para o operacional completar o cadastro.
      const list = await request(app)
        .get(`${env.API_PREFIX}/companies`)
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ pendingRegistration: true });
      expect(list.status).toBe(200);
      expect((list.body as { data: Array<{ cnpj: string | null }> }).data).toHaveLength(2);
    });

    it('CPF válido é aceito como documento da empresa', async () => {
      const response = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .send({
          ...basePayload('msg-005'),
          company: { document: '529.982.247-25', name: 'João da Silva' },
        });

      expect(response.status).toBe(201);
      const company = await prisma.company.findFirstOrThrow({ where: { cnpj: '52998224725' } });
      expect(company.documentType).toBe('CPF');
    });
  });

  describe('POST /intake/attachments', () => {
    async function seedProcess(reference: string): Promise<{ id: string; code: string }> {
      const company =
        (await prisma.company.findFirst({ where: { cnpj: VALID_CNPJ } })) ??
        (await prisma.company.create({
          data: {
            cnpj: VALID_CNPJ,
            legalName: 'Cliente Teste LTDA',
            organizationId: 'org-client-test',
          },
        }));
      const response = await request(app)
        .post(PROCESSES_BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientCompanyId: company.id, reference });
      return response.body as { id: string; code: string };
    }

    it('"Processo <código>" anexa documento e nota ao processo certo', async () => {
      const process = await seedProcess('IMP-2026-0042');

      const response = await request(app)
        .post(`${INTAKE_BASE}/attachments`)
        .set('X-Api-Key', apiKey)
        .field(
          'payload',
          JSON.stringify({
            source: { externalId: 'msg-010', receivedAt: '2026-09-19T08:00:00.000Z' },
            requester: { email: 'joao@clientex-teste.com.br', name: 'João' },
            processRef: process.code.toLowerCase(),
            note: 'Segue o BL conforme solicitado.',
          }),
        )
        .attach('files', Buffer.from('bl'), 'bl.pdf');

      expect(response.status).toBe(201);
      const body = response.body as IntakeResultBody;
      expect(body.event.kind).toBe('ATTACHMENT');
      expect(body.process.id).toBe(process.id);
      expect(body.documents.map((d) => d.originalName)).toEqual(['bl.pdf']);
      expect(body.documents[0]?.receivedAt).toBe('2026-09-19T08:00:00.000Z');
      expect(body.process.additionalInfo).toContain('Segue o BL conforme solicitado.');
      expect(body.process.additionalInfo).toContain('E-mail de João <joao@clientex-teste.com.br>');
      expect(body.process.history.map((h) => h.action)).toEqual([
        'PROCESS_CREATED',
        'DOCUMENT_ADDED',
        'PROCESS_UPDATED',
      ]);
    });

    it('referência ambígua responde 409 com candidatos; processId explícito resolve', async () => {
      const first = await seedProcess('123123');
      await seedProcess('123123');

      const ambiguous = await request(app)
        .post(`${INTAKE_BASE}/attachments`)
        .set('X-Api-Key', apiKey)
        .field(
          'payload',
          JSON.stringify({
            source: { externalId: 'msg-011', receivedAt: '2026-09-19T08:00:00.000Z' },
            requester: { email: 'alguem@dominio-desconhecido.com' },
            processRef: '123123',
          }),
        )
        .attach('files', Buffer.from('x'), 'x.pdf');

      expect(ambiguous.status).toBe(409);
      const error = (ambiguous.body as ErrorBody).error;
      expect(error.code).toBe('PROCESS_REF_AMBIGUOUS');
      expect(error.details?.candidates).toHaveLength(2);

      // Retentativa do mesmo e-mail (evento FAILED) com o processo escolhido.
      const resolved = await request(app)
        .post(`${INTAKE_BASE}/attachments`)
        .set('X-Api-Key', apiKey)
        .field(
          'payload',
          JSON.stringify({
            source: { externalId: 'msg-011', receivedAt: '2026-09-19T08:00:00.000Z' },
            requester: { email: 'alguem@dominio-desconhecido.com' },
            processId: first.id,
          }),
        )
        .attach('files', Buffer.from('x'), 'x.pdf');

      expect(resolved.status).toBe(201);
      expect((resolved.body as IntakeResultBody).process.id).toBe(first.id);
      expect(await prisma.intakeEvent.count()).toBe(1);
    });

    it('referência inexistente responde 404 PROCESS_REF_NOT_FOUND com candidatos parciais', async () => {
      await seedProcess('IMP-2026-0042 / MSKU1234567');

      const response = await request(app)
        .post(`${INTAKE_BASE}/attachments`)
        .set('X-Api-Key', apiKey)
        .send({
          source: { externalId: 'msg-012', receivedAt: '2026-09-19T08:00:00.000Z' },
          requester: { email: 'joao@clientex-teste.com.br' },
          processRef: 'MSKU1234567',
          note: 'informação',
        });

      expect(response.status).toBe(404);
      const error = (response.body as ErrorBody).error;
      expect(error.code).toBe('PROCESS_REF_NOT_FOUND');
      expect(error.details?.candidates).toHaveLength(1);
    });
  });

  describe('GET /intake/processes/lookup e GET /intake/events', () => {
    it('lookup devolve candidatos com matchedBy e events filtra por externalId', async () => {
      await prisma.company.create({
        data: {
          cnpj: VALID_CNPJ,
          legalName: 'Cliente Teste LTDA',
          organizationId: 'org-client-test',
        },
      });
      const created = await request(app)
        .post(`${INTAKE_BASE}/processes`)
        .set('X-Api-Key', apiKey)
        .send(basePayload('msg-020'));
      const process = (created.body as IntakeResultBody).process;

      const lookup = await request(app)
        .get(`${INTAKE_BASE}/processes/lookup`)
        .set('X-Api-Key', apiKey)
        .query({ ref: process.code });
      expect(lookup.status).toBe(200);
      const matches = (
        lookup.body as { matches: Array<{ matchedBy: string; process: { id: string } }> }
      ).matches;
      expect(matches[0]?.matchedBy).toBe('CODE');
      expect(matches[0]?.process.id).toBe(process.id);

      const byRef = await request(app)
        .get(`${INTAKE_BASE}/processes/lookup`)
        .set('X-Api-Key', apiKey)
        .query({ ref: 'imp-2026', companyDocument: VALID_CNPJ });
      expect((byRef.body as { matches: Array<{ matchedBy: string }> }).matches[0]?.matchedBy).toBe(
        'PARTIAL',
      );

      const events = await request(app)
        .get(`${INTAKE_BASE}/events`)
        .set('X-Api-Key', apiKey)
        .query({ externalId: 'msg-020' });
      expect(events.status).toBe(200);
      const list = events.body as {
        data: Array<{ externalId: string; status: string; processId: string }>;
      };
      expect(list.data).toHaveLength(1);
      expect(list.data[0]?.status).toBe('COMPLETED');
      expect(list.data[0]?.processId).toBe(process.id);

      const none = await request(app)
        .get(`${INTAKE_BASE}/events`)
        .set('X-Api-Key', apiKey)
        .query({ externalId: 'nunca-visto' });
      expect((none.body as { data: unknown[] }).data).toHaveLength(0);
    });

    it('lookup sem ref nem companyDocument responde 400', async () => {
      const response = await request(app)
        .get(`${INTAKE_BASE}/processes/lookup`)
        .set('X-Api-Key', apiKey);

      expect(response.status).toBe(400);
    });
  });

  describe('POST /intake/events/skip e GET /intake/cursor (docs/13, decisão 9)', () => {
    it('cursor começa nulo; skip registra IGNORED/ESCALATED e o cursor segue o último examinado', async () => {
      const empty = await request(app).get(`${INTAKE_BASE}/cursor`).set('X-Api-Key', apiKey);
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ channel: 'EMAIL', receivedAt: null, event: null });

      const skipped = await request(app)
        .post(`${INTAKE_BASE}/events/skip`)
        .set('X-Api-Key', apiKey)
        .send({
          source: {
            channel: 'EMAIL',
            externalId: 'msg-skip-1',
            internetMessageId: '<skip-1@clientex.com.br>',
            subject: 'Newsletter',
            receivedAt: '2026-09-21T12:00:00.000Z',
          },
          outcome: 'IGNORED',
          reason: 'Notificação automática do terminal.',
        });
      expect(skipped.status).toBe(201);
      const skippedBody = skipped.body as {
        duplicate: boolean;
        event: {
          kind: string;
          status: string;
          processId: string | null;
          result: { reason: string };
        };
      };
      expect(skippedBody.duplicate).toBe(false);
      expect(skippedBody.event.kind).toBe('IGNORED');
      expect(skippedBody.event.status).toBe('COMPLETED');
      expect(skippedBody.event.processId).toBeNull();
      expect(skippedBody.event.result.reason).toBe('Notificação automática do terminal.');

      // Mesma mensagem com id do Graph novo (cópia em outra pasta): duplicata pela chave secundária.
      const again = await request(app)
        .post(`${INTAKE_BASE}/events/skip`)
        .set('X-Api-Key', apiKey)
        .send({
          source: {
            channel: 'EMAIL',
            externalId: 'msg-skip-1-copia',
            internetMessageId: '<skip-1@clientex.com.br>',
            receivedAt: '2026-09-21T12:00:00.000Z',
          },
          outcome: 'ESCALATED',
          reason: 'Tentativa repetida.',
        });
      expect(again.status).toBe(200);
      expect((again.body as { duplicate: boolean; event: { kind: string } }).duplicate).toBe(true);
      expect((again.body as { event: { kind: string } }).event.kind).toBe('IGNORED');

      // Um FAILED também avança o cursor: a retentativa é pela lista status=FAILED, não pelo cursor.
      const failed = await request(app)
        .post(`${INTAKE_BASE}/attachments`)
        .set('X-Api-Key', apiKey)
        .send({
          source: {
            channel: 'EMAIL',
            externalId: 'msg-skip-2',
            receivedAt: '2026-09-21T13:00:00.000Z',
          },
          requester: { email: 'joao@clientex-teste.com.br' },
          processRef: 'NAO-EXISTE',
          note: 'segue',
        });
      expect(failed.status).toBe(404);

      const cursor = await request(app).get(`${INTAKE_BASE}/cursor`).set('X-Api-Key', apiKey);
      const cursorBody = cursor.body as {
        receivedAt: string;
        event: { externalId: string; status: string };
      };
      expect(cursorBody.receivedAt).toBe('2026-09-21T13:00:00.000Z');
      expect(cursorBody.event).toMatchObject({ externalId: 'msg-skip-2', status: 'FAILED' });

      const failedList = await request(app)
        .get(`${INTAKE_BASE}/events`)
        .set('X-Api-Key', apiKey)
        .query({ status: 'FAILED' });
      expect(
        (failedList.body as { data: Array<{ externalId: string }> }).data.map((e) => e.externalId),
      ).toEqual(['msg-skip-2']);

      // Escalar o FAILED o conclui: sai da lista de retentativa.
      const escalated = await request(app)
        .post(`${INTAKE_BASE}/events/skip`)
        .set('X-Api-Key', apiKey)
        .send({
          source: {
            channel: 'EMAIL',
            externalId: 'msg-skip-2',
            receivedAt: '2026-09-21T13:00:00.000Z',
          },
          requester: { email: 'joao@clientex-teste.com.br', name: 'João' },
          outcome: 'ESCALATED',
          reason: 'Referência não encontrada e sem candidato.',
        });
      expect(escalated.status).toBe(201);
      expect((escalated.body as { event: { kind: string; status: string } }).event).toMatchObject({
        kind: 'ESCALATED',
        status: 'COMPLETED',
      });

      const moved = await request(app).get(`${INTAKE_BASE}/cursor`).set('X-Api-Key', apiKey);
      expect((moved.body as { event: { status: string } }).event.status).toBe('COMPLETED');
      const noneFailed = await request(app)
        .get(`${INTAKE_BASE}/events`)
        .set('X-Api-Key', apiKey)
        .query({ status: 'FAILED' });
      expect((noneFailed.body as { data: unknown[] }).data).toHaveLength(0);

      const escalatedList = await request(app)
        .get(`${INTAKE_BASE}/events`)
        .set('X-Api-Key', apiKey)
        .query({ kind: 'ESCALATED' });
      const list = escalatedList.body as { data: Array<{ externalId: string }> };
      expect(list.data.map((item) => item.externalId)).toEqual(['msg-skip-2']);
    });

    it('skip sem motivo ou com outcome inválido responde 400', async () => {
      const noReason = await request(app)
        .post(`${INTAKE_BASE}/events/skip`)
        .set('X-Api-Key', apiKey)
        .send({
          source: {
            channel: 'EMAIL',
            externalId: 'msg-skip-3',
            receivedAt: '2026-09-21T12:00:00.000Z',
          },
          outcome: 'IGNORED',
        });
      expect(noReason.status).toBe(400);

      const badOutcome = await request(app)
        .post(`${INTAKE_BASE}/events/skip`)
        .set('X-Api-Key', apiKey)
        .send({
          source: {
            channel: 'EMAIL',
            externalId: 'msg-skip-3',
            receivedAt: '2026-09-21T12:00:00.000Z',
          },
          outcome: 'PROCESS',
          reason: 'não pode',
        });
      expect(badOutcome.status).toBe(400);
    });
  });

  describe('autorização', () => {
    it('CLIENT recebe 403 em todas as rotas de intake', async () => {
      await createUser(prisma, 'org-client-test', 'cliente@clientex-teste.com.br', 'CLIENT');
      const clientToken = await login(app, 'cliente@clientex-teste.com.br');

      const responses = await Promise.all([
        request(app)
          .post(`${INTAKE_BASE}/processes`)
          .set('Authorization', `Bearer ${clientToken}`)
          .send(basePayload('msg-030')),
        request(app)
          .post(`${INTAKE_BASE}/attachments`)
          .set('Authorization', `Bearer ${clientToken}`)
          .send({}),
        request(app)
          .get(`${INTAKE_BASE}/processes/lookup`)
          .set('Authorization', `Bearer ${clientToken}`)
          .query({ ref: 'x' }),
        request(app).get(`${INTAKE_BASE}/events`).set('Authorization', `Bearer ${clientToken}`),
      ]);

      expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    });

    it('sem credencial responde 401', async () => {
      const response = await request(app).post(`${INTAKE_BASE}/processes`).send(basePayload('x'));
      expect(response.status).toBe(401);
    });

    it('chave inválida repetida estoura o limitador de falhas (429), sem afetar a chave válida', async () => {
      const limited = buildTestApp(
        prisma,
        buildRateLimiters({
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
          apiKeyFailureMaxRequests: 3,
          apiKeyFailureWindowMs: 60_000,
        }),
      );

      // Requisições com a chave válida não entram na contagem...
      for (let i = 0; i < 3; i += 1) {
        const ok = await request(limited).get(`${INTAKE_BASE}/events`).set('X-Api-Key', apiKey);
        expect(ok.status).toBe(200);
      }

      // ...só as 401: a quarta falha do mesmo IP é cortada.
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await request(limited)
          .get(`${INTAKE_BASE}/events`)
          .set('X-Api-Key', 'apk_invalida');
        statuses.push(response.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);

      // Outro IP (trust proxy = 1 honra X-Forwarded-For) não é afetado.
      const otherIp = await request(limited)
        .get(`${INTAKE_BASE}/events`)
        .set('X-Forwarded-For', '203.0.113.5')
        .set('X-Api-Key', apiKey);
      expect(otherIp.status).toBe(200);
    });
  });
});
