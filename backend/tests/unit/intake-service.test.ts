import { FakeCnpjLookupProvider } from '../helpers/fakes/fake-cnpj-lookup-provider';
import { FakeIlogProcessSource, makeIlogProcess } from '../helpers/fakes/fake-ilog-process-source';
import { FakeMailAttachmentProvider } from '../helpers/fakes/fake-mail-attachment-provider';
import { FakeMailboxOrganizer } from '../helpers/fakes/fake-mailbox-organizer';
import { FakeMailboxReader } from '../helpers/fakes/fake-mailbox-reader';
import { FakeStorageProvider } from '../helpers/fakes/fake-storage-provider';
import { InMemoryCompanyRepository } from '../helpers/fakes/in-memory-company-repository';
import { InMemoryDocumentRepository } from '../helpers/fakes/in-memory-document-repository';
import { InMemoryEmailDomainRepository } from '../helpers/fakes/in-memory-email-domain-repository';
import { InMemoryIlogSyncStateRepository } from '../helpers/fakes/in-memory-ilog-sync-state-repository';
import { InMemoryIntakeCursorRepository } from '../helpers/fakes/in-memory-intake-cursor-repository';
import { InMemoryIntakeEventRepository } from '../helpers/fakes/in-memory-intake-event-repository';
import { InMemoryKanbanStageRepository } from '../helpers/fakes/in-memory-kanban-stage-repository';
import { InMemoryOrganizationRepository } from '../helpers/fakes/in-memory-organization-repository';
import { InMemoryProcessIdentifierRepository } from '../helpers/fakes/in-memory-process-identifier-repository';
import { InMemoryProcessRepository } from '../helpers/fakes/in-memory-process-repository';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import type { Company } from '@/domain/entities/company';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/domain/errors/app-error';
import { DocumentService } from '@/services/document-service';
import { IlogSyncService } from '@/services/ilog-sync-service';
import type {
  AttachIntakeInput,
  CreateProcessIntakeInput,
  SkipIntakeInput,
} from '@/services/intake-service';
import { cleanBodyText, sanitizeFolderName } from '@/services/intake-service';
import { IntakeService } from '@/services/intake-service';
import { ProcessService } from '@/services/process-service';

const VALID_CNPJ = '11222333000181';
const OTHER_CNPJ = '05557450000608';
const VALID_CPF = '52998224725';
const ACTOR = 'agent-user';
const RECEIVED_AT = new Date('2026-09-18T13:32:00.000Z');

interface Context {
  service: IntakeService;
  intakeEventRepository: InMemoryIntakeEventRepository;
  intakeCursorRepository: InMemoryIntakeCursorRepository;
  processRepository: InMemoryProcessRepository;
  companyRepository: InMemoryCompanyRepository;
  organizationRepository: InMemoryOrganizationRepository;
  emailDomainRepository: InMemoryEmailDomainRepository;
  documentRepository: InMemoryDocumentRepository;
  cnpjLookupProvider: FakeCnpjLookupProvider;
  mailAttachmentProvider: FakeMailAttachmentProvider;
  mailboxReader: FakeMailboxReader;
  mailboxOrganizer: FakeMailboxOrganizer;
  processIdentifierRepository: InMemoryProcessIdentifierRepository;
  ilogSource: FakeIlogProcessSource;
  clientOrganizationId: string;
}

async function buildContext(
  overrides: { cnpjLookup?: boolean; mailAttachments?: boolean; ilog?: boolean } = {},
): Promise<Context> {
  const intakeEventRepository = new InMemoryIntakeEventRepository();
  const intakeCursorRepository = new InMemoryIntakeCursorRepository();
  const processRepository = new InMemoryProcessRepository();
  const companyRepository = new InMemoryCompanyRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const emailDomainRepository = new InMemoryEmailDomainRepository();
  const documentRepository = new InMemoryDocumentRepository();
  const stageRepository = new InMemoryKanbanStageRepository();
  const userRepository = new InMemoryUserRepository();
  const cnpjLookupProvider = new FakeCnpjLookupProvider();
  const mailAttachmentProvider = new FakeMailAttachmentProvider();
  const mailboxReader = new FakeMailboxReader();
  const mailboxOrganizer = new FakeMailboxOrganizer();
  const processIdentifierRepository = new InMemoryProcessIdentifierRepository(
    processRepository.identifiers,
    (processId) => processRepository.items.some((p) => p.id === processId && p.deletedAt === null),
  );
  const ilogSource = new FakeIlogProcessSource();

  const stage = await stageRepository.create({
    name: 'Entrada',
    color: '#1677ff',
    isFinal: false,
    order: 0,
  });
  processRepository.stages.push({ ...stage });
  processRepository.users.push({
    id: ACTOR,
    name: 'Agente de E-mail',
    email: 'agente@opusce.com.br',
  });
  documentRepository.users.push({ id: ACTOR, name: 'Agente de E-mail' });

  const clientOrganization = await organizationRepository.create({
    name: 'Cliente X',
    isInternal: false,
  });
  await emailDomainRepository.create({
    domain: 'clientex.com.br',
    organizationId: clientOrganization.id,
    defaultRole: 'CLIENT',
    autoApprove: true,
  });

  const processService = new ProcessService({
    processRepository,
    processIdentifierRepository,
    companyRepository,
    stageRepository,
    userRepository,
  });
  await userRepository.create({
    name: 'Admin',
    email: 'admin@opusce.com.br',
    passwordHash: null,
    role: 'ADMIN',
    status: 'ACTIVE',
    accessScope: 'ORGANIZATION',
    organizationId: null,
  });
  const ilogSyncService =
    overrides.ilog === true
      ? new IlogSyncService({
          source: ilogSource,
          syncStateRepository: new InMemoryIlogSyncStateRepository(),
          processRepository,
          processIdentifierRepository,
          companyRepository,
          organizationRepository,
          emailDomainRepository,
          userRepository,
          processService,
          logger: { info: () => undefined, warn: () => undefined },
          options: { backfillDays: 90, changelogLimit: 100, actorEmail: null },
        })
      : null;
  const documentService = new DocumentService({
    documentRepository,
    processRepository,
    storageProvider: new FakeStorageProvider(),
    maxFilesPerRequest: 10,
  });

  const service = new IntakeService({
    intakeEventRepository,
    intakeCursorRepository,
    processRepository,
    processIdentifierRepository,
    companyRepository,
    organizationRepository,
    emailDomainRepository,
    processService,
    documentService,
    ilogSyncService,
    cnpjLookupProvider: overrides.cnpjLookup === false ? null : cnpjLookupProvider,
    mailAttachmentProvider: overrides.mailAttachments === false ? null : mailAttachmentProvider,
    mailboxReader: overrides.mailAttachments === false ? null : mailboxReader,
    mailboxOrganizer: overrides.mailAttachments === false ? null : mailboxOrganizer,
    organizeFolder: 'Processos IA',
    maxAttachmentBytes: 1024,
  });

  return {
    service,
    intakeEventRepository,
    intakeCursorRepository,
    processRepository,
    companyRepository,
    organizationRepository,
    emailDomainRepository,
    documentRepository,
    cnpjLookupProvider,
    mailAttachmentProvider,
    mailboxReader,
    mailboxOrganizer,
    processIdentifierRepository,
    ilogSource,
    clientOrganizationId: clientOrganization.id,
  };
}

async function seedCompany(
  ctx: Context,
  cnpj: string,
  organizationId: string,
  overrides: Partial<Company> = {},
): Promise<Company> {
  const company = await ctx.companyRepository.create({
    cnpj,
    documentType: cnpj.length === 11 ? 'CPF' : 'CNPJ',
    legalName: `Empresa ${cnpj}`,
    tradeName: null,
    organizationId,
  });
  Object.assign(company, overrides);
  ctx.processRepository.companies.push({
    id: company.id,
    cnpj: company.cnpj,
    legalName: company.legalName,
  });
  return company;
}

function createInput(overrides: Partial<CreateProcessIntakeInput> = {}): CreateProcessIntakeInput {
  return {
    source: { channel: 'EMAIL', externalId: 'msg-1', subject: 'Abertura', receivedAt: RECEIVED_AT },
    requester: { email: 'joao@clientex.com.br', name: 'João' },
    company: { document: VALID_CNPJ, name: 'Cliente X LTDA' },
    reference: 'IMP-2026-0042',
    additionalInfo: 'Carga com LI pendente.',
    fetchAttachments: false,
    files: [],
    ...overrides,
  };
}

function attachInput(overrides: Partial<AttachIntakeInput> = {}): AttachIntakeInput {
  return {
    source: {
      channel: 'EMAIL',
      externalId: 'msg-2',
      subject: 'Re: processo',
      receivedAt: RECEIVED_AT,
    },
    requester: { email: 'joao@clientex.com.br', name: 'João' },
    processRef: null,
    processId: null,
    note: null,
    fetchAttachments: false,
    files: [],
    ...overrides,
  };
}

const pdf = (name: string): { originalName: string; mimeType: string; buffer: Buffer } => ({
  originalName: name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`conteudo de ${name}`),
});

describe('IntakeService (docs/13)', () => {
  describe('createProcessFromEmail — cadastro automático (decisão 5)', () => {
    it('cria organização, empresa e processo para CNPJ desconhecido com domínio desconhecido', async () => {
      const ctx = await buildContext();
      ctx.cnpjLookupProvider.respondFound({ cnpj: OTHER_CNPJ, legalName: 'NOVA EMPRESA LTDA' });

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          requester: { email: 'maria@novaempresa.com.br', name: 'Maria' },
          company: { document: OTHER_CNPJ },
          files: [pdf('invoice.pdf')],
        }),
      );

      expect(result.duplicate).toBe(false);
      expect(result.process.source).toBe('EMAIL');
      expect(result.process.requesterEmail).toBe('maria@novaempresa.com.br');
      expect(result.process.receivedAt).toEqual(RECEIVED_AT);
      expect(result.company?.created).toBe(true);
      expect(result.organization?.created).toBe(true);
      expect(result.organization?.domainRegistered).toBe(true);

      const company = await ctx.companyRepository.findByCnpj(OTHER_CNPJ);
      expect(company?.legalName).toBe('NOVA EMPRESA LTDA');
      expect(company?.documentType).toBe('CNPJ');

      const domain = await ctx.emailDomainRepository.findByDomain('novaempresa.com.br');
      expect(domain?.autoApprove).toBe(false);
      expect(domain?.defaultRole).toBe('CLIENT');
      expect(domain?.organizationId).toBe(company?.organizationId);

      expect(ctx.documentRepository.items).toHaveLength(1);
      expect(ctx.documentRepository.items[0]?.source).toBe('EMAIL');
      expect(ctx.documentRepository.items[0]?.receivedAt).toEqual(RECEIVED_AT);
      expect(result.event.status).toBe('COMPLETED');
      expect(result.event.result?.documentIds).toHaveLength(1);
      expect(result.warnings.some((w) => w.includes('cadastrada automaticamente'))).toBe(true);
    });

    it('vincula a empresa nova à organização do domínio do solicitante quando o domínio é conhecido', async () => {
      const ctx = await buildContext();
      ctx.cnpjLookupProvider.respondFound({ cnpj: VALID_CNPJ, legalName: 'CLIENTE X LTDA' });

      const result = await ctx.service.createProcessFromEmail(ACTOR, createInput());

      expect(result.organization?.created).toBe(false);
      expect(result.organization?.id).toBe(ctx.clientOrganizationId);
      expect(ctx.organizationRepository.items).toHaveLength(1);
    });

    it('não cadastra domínio de webmail público na organização criada', async () => {
      const ctx = await buildContext({ cnpjLookup: false });

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ requester: { email: 'fulano@gmail.com' } }),
      );

      expect(result.organization?.created).toBe(true);
      expect(result.organization?.domainRegistered).toBe(false);
      expect(await ctx.emailDomainRepository.findByDomain('gmail.com')).toBeNull();
    });

    it('usa o nome do e-mail quando a consulta à Receita está desligada e o documento como último recurso', async () => {
      const ctx = await buildContext({ cnpjLookup: false });

      await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ company: { document: VALID_CNPJ, name: '  Nome do E-mail  ' } }),
      );
      // O fake de ProcessRepository não conhece empresas criadas em runtime;
      // o nome é conferido no repositório de empresas.
      expect((await ctx.companyRepository.findByCnpj(VALID_CNPJ))?.legalName).toBe(
        'Nome do E-mail',
      );

      const unnamed = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-x', receivedAt: RECEIVED_AT },
          company: { document: OTHER_CNPJ },
        }),
      );
      expect((await ctx.companyRepository.findByCnpj(OTHER_CNPJ))?.legalName).toBe(
        'CNPJ 05.557.450/0006-08',
      );
      expect(unnamed.warnings.some((w) => w.includes('Sem razão social'))).toBe(true);
    });

    it('aceita CPF válido e cadastra a pessoa física com documentType = CPF', async () => {
      const ctx = await buildContext();

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ company: { document: '529.982.247-25', name: 'João da Silva' } }),
      );

      const company = await ctx.companyRepository.findByCnpj(VALID_CPF);
      expect(company?.documentType).toBe('CPF');
      expect(company?.legalName).toBe('João da Silva');
      expect(result.company?.created).toBe(true);
      expect(ctx.cnpjLookupProvider.calls).toHaveLength(0);
    });

    it('rejeita CNPJ e CPF inválidos com 400 e códigos distintos', async () => {
      const ctx = await buildContext();

      await expect(
        ctx.service.createProcessFromEmail(
          ACTOR,
          createInput({ company: { document: '11222333000180' } }),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CNPJ', status: 400 });

      await expect(
        ctx.service.createProcessFromEmail(
          ACTOR,
          createInput({
            source: { channel: 'EMAIL', externalId: 'msg-cpf', receivedAt: RECEIVED_AT },
            company: { document: '52998224726' },
          }),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CPF', status: 400 });
    });

    it('reaproveita empresa existente sem consultar a Receita', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);

      const result = await ctx.service.createProcessFromEmail(ACTOR, createInput());

      expect(result.company).toEqual({ id: company.id, created: false });
      expect(ctx.cnpjLookupProvider.calls).toHaveLength(0);
      expect(ctx.companyRepository.items).toHaveLength(1);
    });

    it('empresa inativa responde 409 COMPANY_INACTIVE e marca o evento como FAILED', async () => {
      const ctx = await buildContext();
      await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId, { isActive: false });

      await expect(ctx.service.createProcessFromEmail(ACTOR, createInput())).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(ctx.intakeEventRepository.items[0]?.status).toBe('FAILED');
      expect(ctx.intakeEventRepository.items[0]?.errorMessage).toContain('inativa');
    });

    it('cadastra também a empresa solicitante (modelo trading) quando informada', async () => {
      const ctx = await buildContext({ cnpjLookup: false });

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          requestingCompany: { document: OTHER_CNPJ, name: 'Trading Solicitante' },
        }),
      );

      const requesting = await ctx.companyRepository.findByCnpj(OTHER_CNPJ);
      expect(requesting?.legalName).toBe('Trading Solicitante');
      expect(ctx.processRepository.items[0]?.requestingCompanyId).toBe(requesting?.id);
      expect(result.process.id).toBe(ctx.processRepository.items[0]?.id);
      expect(ctx.companyRepository.items).toHaveLength(2);
    });
  });

  describe('createProcessFromEmail — empresa pelo domínio do solicitante (decisão 5)', () => {
    it('sem documento, resolve a única empresa ativa da organização do domínio', async () => {
      const ctx = await buildContext();
      await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ company: { document: null, name: null } }),
      );

      expect(result.process.clientCompany.cnpj).toBe(VALID_CNPJ);
      expect(result.company?.created).toBe(false);
      expect(result.organization).toEqual({
        id: ctx.clientOrganizationId,
        created: false,
        domainRegistered: false,
      });
      expect(result.warnings.some((w) => w.includes('resolvida pelo domínio'))).toBe(true);
      expect(ctx.cnpjLookupProvider.calls).toHaveLength(0);
    });

    it('empresa inativa não conta; várias ativas usam o nome da assinatura como desempate', async () => {
      const ctx = await buildContext();
      await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId, { isActive: false });
      const filial = await seedCompany(ctx, OTHER_CNPJ, ctx.clientOrganizationId);
      await ctx.companyRepository.update(filial.id, { tradeName: 'Filial Duque' });
      const matriz = await seedCompany(ctx, VALID_CPF, ctx.clientOrganizationId);
      await ctx.companyRepository.update(matriz.id, { legalName: 'Cliente X Matriz' });

      await expect(
        ctx.service.createProcessFromEmail(
          ACTOR,
          createInput({ company: { document: null, name: null } }),
        ),
      ).rejects.toMatchObject({ code: 'COMPANY_AMBIGUOUS', status: 409 });

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-dq', receivedAt: RECEIVED_AT },
          company: { document: null, name: 'filial duque' },
        }),
      );
      expect(result.process.clientCompany.cnpj).toBe(OTHER_CNPJ);
    });

    it('webmail público sem documento responde 400 COMPANY_REQUIRED e marca o evento FAILED', async () => {
      const ctx = await buildContext();
      await expect(
        ctx.service.createProcessFromEmail(
          ACTOR,
          createInput({ requester: { email: 'alguem@gmail.com' }, company: { document: null } }),
        ),
      ).rejects.toMatchObject({ code: 'COMPANY_REQUIRED', status: 400 });
      expect(ctx.processRepository.items).toHaveLength(0);
      expect(ctx.intakeEventRepository.items[0]?.status).toBe('FAILED');
    });

    it('domínio corporativo desconhecido cria organização, domínio e empresa em cadastro pendente (decisão 10)', async () => {
      const ctx = await buildContext();

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          requester: { email: 'importacao@casaenovidade.com.br', name: 'Gabriel' },
          company: { document: null, name: 'Casa & Novidade' },
          reference: '230/26 / BL 0406',
        }),
      );

      expect(result.company?.created).toBe(true);
      expect(result.organization).toMatchObject({ created: true, domainRegistered: true });
      const company = await ctx.companyRepository.findById(result.company?.id ?? '');
      expect(company).toMatchObject({
        cnpj: null,
        documentType: null,
        legalName: 'Casa & Novidade',
        isActive: true,
      });
      expect(result.process.clientCompany.id).toBe(company?.id);
      expect(
        (await ctx.emailDomainRepository.findByDomain('casaenovidade.com.br'))?.autoApprove,
      ).toBe(false);
      expect(result.warnings.some((w) => w.includes('cadastro pendente'))).toBe(true);
      expect(ctx.cnpjLookupProvider.calls).toHaveLength(0);
    });

    it('domínio conhecido sem empresa cria a pendente na organização existente; sem nome usa o domínio', async () => {
      const ctx = await buildContext();

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ company: { document: null } }),
      );

      const company = await ctx.companyRepository.findById(result.company?.id ?? '');
      expect(company?.organizationId).toBe(ctx.clientOrganizationId);
      expect(company?.legalName).toBe('clientex.com.br');
      expect(result.organization?.created).toBe(false);

      // Segundo e-mail do mesmo domínio reaproveita a pendente em vez de criar outra.
      const again = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-3', receivedAt: RECEIVED_AT },
          company: { document: null },
        }),
      );
      expect(again.process.clientCompany.id).toBe(company?.id);
      expect(ctx.companyRepository.items).toHaveLength(1);
    });

    it('e-mail posterior com CNPJ conclui o cadastro pendente da organização em vez de criar outra empresa', async () => {
      const ctx = await buildContext();
      ctx.cnpjLookupProvider.respondFound({ cnpj: VALID_CNPJ, legalName: 'CLIENTE X LTDA' });
      const first = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ company: { document: null, name: 'Cliente X' } }),
      );

      const second = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-3', receivedAt: RECEIVED_AT },
          company: { document: VALID_CNPJ },
        }),
      );

      expect(second.company?.id).toBe(first.company?.id);
      expect(second.company?.created).toBe(false);
      const company = await ctx.companyRepository.findById(first.company?.id ?? '');
      expect(company).toMatchObject({
        cnpj: VALID_CNPJ,
        documentType: 'CNPJ',
        legalName: 'CLIENTE X LTDA',
      });
      expect(ctx.companyRepository.items).toHaveLength(1);
      expect(second.warnings.some((w) => w.includes('concluído'))).toBe(true);
    });
  });

  describe('remetente terceiro: empresa pelo nome (decisão 11)', () => {
    it('senderIsClient=false sem nome responde COMPANY_REQUIRED; com nome desconhecido cria pendente sem domínio', async () => {
      const ctx = await buildContext();

      await expect(
        ctx.service.createProcessFromEmail(
          ACTOR,
          createInput({
            requester: { email: 'op3@cilagency.com.br', name: 'Isabela' },
            company: { document: null, senderIsClient: false },
          }),
        ),
      ).rejects.toMatchObject({ code: 'COMPANY_REQUIRED' });

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-3p', receivedAt: RECEIVED_AT },
          requester: { email: 'op3@cilagency.com.br', name: 'Isabela' },
          company: { document: null, name: 'FU XING COMERCIO', senderIsClient: false },
          reference: '02935-0726IM / NBZY26071470',
        }),
      );
      expect(result.company?.created).toBe(true);
      expect(result.organization).toMatchObject({ created: true, domainRegistered: false });
      const company = await ctx.companyRepository.findById(result.company?.id ?? '');
      expect(company).toMatchObject({ cnpj: null, legalName: 'FU XING COMERCIO' });
      // O domínio do agente não vira vínculo com o cliente.
      expect(await ctx.emailDomainRepository.findByDomain('cilagency.com.br')).toBeNull();
      expect(result.process.requesterEmail).toBe('op3@cilagency.com.br');
    });

    it('senderIsClient=false com nome que corresponde a uma empresa existente usa essa empresa', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      await ctx.companyRepository.update(company.id, { legalName: 'PROMEDON DO BRASIL LTDA' });

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          requester: { email: 'tatiana@agente.com.br' },
          company: { document: null, name: 'Promedon', senderIsClient: false },
        }),
      );
      expect(result.company).toEqual({ id: company.id, created: false });
      expect(ctx.companyRepository.items).toHaveLength(1);
    });
  });

  describe('caixa pelo servidor: listMailbox e getMailboxMessage (decisão 9)', () => {
    it('lista desde after, descarta remetentes bloqueados e devolve nextAfter da última listada', async () => {
      const ctx = await buildContext();
      const t = (minute: number): Date =>
        new Date(`2026-09-21T15:${String(minute).padStart(2, '0')}:00.000Z`);
      ctx.mailboxReader.add({
        id: 'a',
        receivedAt: t(1),
        subject: 'Antigo',
        from: { name: 'X', email: 'x@cliente.com' },
      });
      ctx.mailboxReader.add({
        id: 'b',
        receivedAt: t(5),
        subject: 'Fatura',
        from: { name: 'Multiterminais', email: 'faturamento@multiterminais.com.br' },
      });
      ctx.mailboxReader.add({
        id: 'c',
        receivedAt: t(6),
        subject: 'Novo Processo',
        from: { name: 'Gabriel', email: 'importacao@casaenovidade.com.br' },
      });
      ctx.mailboxReader.add({
        id: 'd',
        receivedAt: t(7),
        subject: 'DUIMP',
        from: { name: 'Vitória', email: 'vitoria@opusce.com.br' },
      });
      ctx.mailboxReader.add({
        id: 'e',
        receivedAt: t(9),
        subject: 'Depois',
        from: { name: null, email: 'z@z.com' },
      });

      const result = await ctx.service.listMailbox({
        after: t(2),
        limit: 3,
        excludeSenders: ['@opusce.com.br', 'MULTITERMINAIS'],
      });
      expect(result.messages.map((m) => m.id)).toEqual(['c']);
      expect(result).toMatchObject({ listed: 3, blocked: 2, nextAfter: t(7), hasMore: true });
      expect(ctx.mailboxReader.listCalls[0]).toEqual({ after: t(2), limit: 3 });
    });

    it('anota cada mensagem com o evento de intake que já tiver, por externalId ou internetMessageId', async () => {
      const ctx = await buildContext();
      const t = (minute: number): Date =>
        new Date(`2026-09-21T15:${String(minute).padStart(2, '0')}:00.000Z`);
      ctx.mailboxReader.add({ id: 'novo', receivedAt: t(1) });
      ctx.mailboxReader.add({ id: 'pulado', receivedAt: t(2) });
      ctx.mailboxReader.add({ id: 'movido', receivedAt: t(3), internetMessageId: '<movido@x>' });
      await ctx.service.skipEmail(ACTOR, {
        source: { channel: 'EMAIL', externalId: 'pulado', receivedAt: t(2) },
        outcome: 'IGNORED',
        reason: 'Confirmação de recebimento.',
      });
      // Registrada com o id antigo do Graph (antes de a mensagem mudar de pasta).
      const moved = await ctx.service.skipEmail(ACTOR, {
        source: {
          channel: 'EMAIL',
          externalId: 'id-antigo',
          internetMessageId: '<movido@x>',
          receivedAt: t(3),
        },
        outcome: 'ESCALATED',
        reason: 'pedido fora do intake',
      });

      const result = await ctx.service.listMailbox({ after: t(0), limit: 10, excludeSenders: [] });
      expect(result.messages.map((m) => [m.id, m.intake])).toEqual([
        ['novo', null],
        ['pulado', expect.objectContaining({ status: 'COMPLETED', kind: 'IGNORED' })],
        [
          'movido',
          { eventId: moved.event.id, status: 'COMPLETED', kind: 'ESCALATED', processId: null },
        ],
      ]);
    });

    it('detalhe devolve corpo limpo, sem histórico citado, e anexos sem inline', async () => {
      const ctx = await buildContext();
      ctx.mailboxReader.add({
        id: 'm1',
        receivedAt: RECEIVED_AT,
        subject: 'RES: PRÉ ALERTA',
        from: { name: 'Ruan', email: 'ruan@globoimport.com.br' },
        to: ['opusoperacional@opusce.com.br'],
        bodyText:
          'Bom dia Vitória\r\n\r\nNesse caso, será removido a Marimex,\r\n\r\n\r\nObrigado\r\n\r\nDe: Vitória Todeschini <vitoria@opusce.com.br>\r\nEnviada em: segunda\r\nPara: Ruan\r\nAssunto: PRÉ ALERTA\r\n\r\nPrezados, segue pré alerta...',
        hasAttachments: true,
        attachments: [
          { name: 'image001.png', mimeType: 'image/png', size: 10, isInline: true },
          { name: 'HBL.pdf', mimeType: 'application/pdf', size: 1000, isInline: false },
        ],
      });

      const view = await ctx.service.getMailboxMessage('m1', 6000);
      expect(view.bodyText).toBe(
        'Bom dia Vitória\n\nNesse caso, será removido a Marimex,\n\nObrigado',
      );
      expect(view.bodyTruncated).toBe(false);
      expect(view.attachments).toEqual([
        { name: 'HBL.pdf', mimeType: 'application/pdf', size: 1000, isInline: false },
      ]);
      expect(view.to).toEqual(['opusoperacional@opusce.com.br']);

      await expect(ctx.service.getMailboxMessage('nao-existe', 6000)).rejects.toMatchObject({
        code: 'MAIL_MESSAGE_NOT_FOUND',
      });
    });

    it('sem leitor (Graph desligado) responde 503 MAIL_READ_DISABLED; provedor indisponível responde MAIL_UNAVAILABLE', async () => {
      const off = await buildContext({ mailAttachments: false });
      await expect(
        off.service.listMailbox({ after: RECEIVED_AT, limit: 10, excludeSenders: [] }),
      ).rejects.toMatchObject({ code: 'MAIL_READ_DISABLED', status: 503 });

      const ctx = await buildContext();
      ctx.mailboxReader.unavailable = 'Graph fora do ar';
      await expect(
        ctx.service.listMailbox({ after: RECEIVED_AT, limit: 10, excludeSenders: [] }),
      ).rejects.toMatchObject({ code: 'MAIL_UNAVAILABLE', status: 503 });
    });

    it('cleanBodyText corta no marcador de histórico, ignora marcador no início e trunca', () => {
      expect(cleanBodyText('De: alguém\nOi\n\n\n\nTchau   \n', 100)).toEqual({
        text: 'De: alguém\nOi\n\nTchau',
        truncated: false,
      });
      const long = `${'a'.repeat(50)}\n\nOn Mon, Sep 21, 2026 at 10:00 AM John <j@x.com> wrote:\n> citado`;
      expect(cleanBodyText(long, 10)).toEqual({ text: `${'a'.repeat(10)}\n[…]`, truncated: true });
      expect(cleanBodyText(long, 100).text).toBe('a'.repeat(50));
      expect(
        cleanBodyText(`Segue o documento.\n${'_'.repeat(30)}\nFrom: x\nquoted`, 100).text,
      ).toBe('Segue o documento.');
    });
  });

  describe('cópia do e-mail para a pasta da organização (decisão 12)', () => {
    it('ao criar e ao complementar, copia o e-mail para <pasta>/<Organização>; falha vira aviso', async () => {
      const ctx = await buildContext();
      await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);

      const created = await ctx.service.createProcessFromEmail(ACTOR, createInput());
      expect(ctx.mailboxOrganizer.copies).toEqual([
        { messageId: 'msg-1', folderPath: ['Processos IA', 'Cliente X'] },
      ]);
      expect(created.warnings.some((w) => w.includes('não copiado'))).toBe(false);

      ctx.mailboxOrganizer.outcome = { kind: 'FORBIDDEN' };
      const attached = await ctx.service.attachToProcess(
        ACTOR,
        attachInput({ processId: created.process.id, note: 'segue HBL' }),
      );
      expect(ctx.mailboxOrganizer.copies[1]).toEqual({
        messageId: 'msg-2',
        folderPath: ['Processos IA', 'Cliente X'],
      });
      expect(attached.event.status).toBe('COMPLETED');
      expect(attached.warnings.some((w) => w.includes('Mail.ReadWrite'))).toBe(true);
      // O aviso fica gravado no evento, para o operacional ver depois.
      expect(attached.event.result?.warnings.some((w) => w.includes('Mail.ReadWrite'))).toBe(true);
    });

    it('sem organizer (GRAPH_ORGANIZE_ENABLED=false) nada é copiado e nada avisa', async () => {
      const ctx = await buildContext({ mailAttachments: false });
      await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      const created = await ctx.service.createProcessFromEmail(ACTOR, createInput());
      expect(ctx.mailboxOrganizer.copies).toHaveLength(0);
      expect(created.warnings.some((w) => w.includes('copiado'))).toBe(false);
    });

    it('sanitizeFolderName remove caracteres proibidos e limita o tamanho', () => {
      expect(sanitizeFolderName('  Casa & Novidade  ')).toBe('Casa & Novidade');
      expect(sanitizeFolderName('FU XING / COMERCIO: "A" <B>')).toBe('FU XING - COMERCIO- -A- -B-');
      expect(sanitizeFolderName('   ')).toBe('Sem organização');
      expect(sanitizeFolderName('x'.repeat(150))).toHaveLength(100);
    });
  });

  describe('attachToProcess — identificadores novos na referência (decisão 11)', () => {
    it('acrescenta identificadores que faltam, ignora repetidos e respeita 255 caracteres', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      const process = await ctx.processRepository.createWithHistory({
        reference: '230/26',
        additionalInfo: null,
        clientCompanyId: company.id,
        requestingCompanyId: null,
        currentStageId: ctx.processRepository.stages[0]?.id ?? 'stage',
        createdById: ACTOR,
        source: 'WEB',
        requesterName: null,
        requesterEmail: null,
        receivedAt: null,
      });

      const result = await ctx.service.attachToProcess(
        ACTOR,
        attachInput({
          processId: process.id,
          addReferences: ['BL 0406', '230/26', 'bl 0406', 'x'.repeat(250)],
        }),
      );
      expect(result.process.reference).toBe('230/26 / BL 0406');
      expect(result.warnings.some((w) => w.includes('Referência cheia'))).toBe(true);
      expect(result.process.history.some((h) => h.action === 'PROCESS_UPDATED')).toBe(true);
    });
  });

  describe('idempotência por externalId (decisão 4)', () => {
    it('segunda chamada com o mesmo externalId devolve duplicate: true sem criar nada', async () => {
      const ctx = await buildContext({ cnpjLookup: false });
      const first = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ files: [pdf('a.pdf')] }),
      );

      const second = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ files: [pdf('a.pdf')] }),
      );

      expect(second.duplicate).toBe(true);
      expect(second.process.id).toBe(first.process.id);
      expect(second.event.id).toBe(first.event.id);
      expect(ctx.processRepository.items).toHaveLength(1);
      expect(ctx.documentRepository.items).toHaveLength(1);
      expect(ctx.intakeEventRepository.items).toHaveLength(1);
    });

    it('evento em PROCESSING responde 409 INTAKE_IN_PROGRESS', async () => {
      const ctx = await buildContext({ cnpjLookup: false });
      await ctx.intakeEventRepository.claim({
        channel: 'EMAIL',
        externalId: 'msg-1',
        internetMessageId: null,
        kind: 'PROCESS',
        status: 'PROCESSING',
        subject: null,
        requesterName: null,
        requesterEmail: 'x@y.com',
        receivedAt: RECEIVED_AT,
        createdById: ACTOR,
      });

      await expect(ctx.service.createProcessFromEmail(ACTOR, createInput())).rejects.toMatchObject({
        code: 'INTAKE_IN_PROGRESS',
        status: 409,
      });
    });

    it('retoma evento FAILED anexando ao processo já criado em vez de criar outro', async () => {
      const ctx = await buildContext({ cnpjLookup: false });
      // Primeira execução: falha depois de criar o processo (Graph fora do ar).
      ctx.mailAttachmentProvider.outcome = { kind: 'UNAVAILABLE', reason: 'Graph fora do ar' };
      await expect(
        ctx.service.createProcessFromEmail(ACTOR, createInput({ fetchAttachments: true })),
      ).rejects.toMatchObject({ code: 'MAIL_ATTACHMENTS_UNAVAILABLE', status: 503 });
      const failed = ctx.intakeEventRepository.items[0];
      expect(failed?.status).toBe('FAILED');
      // Anexos são baixados ANTES de criar o processo: nada foi criado.
      expect(ctx.processRepository.items).toHaveLength(0);

      // Simula falha tardia: processo existe, evento FAILED apontando para ele.
      const created = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-late', receivedAt: RECEIVED_AT },
        }),
      );
      const lateEvent = ctx.intakeEventRepository.items[1];
      if (!lateEvent) throw new Error('evento esperado');
      lateEvent.status = 'FAILED';
      lateEvent.result = null;

      ctx.mailAttachmentProvider.respondWith([{ name: 'bl.pdf', content: Buffer.from('bl') }]);
      const resumed = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-late', receivedAt: RECEIVED_AT },
          fetchAttachments: true,
        }),
      );

      expect(resumed.duplicate).toBe(false);
      expect(resumed.process.id).toBe(created.process.id);
      expect(ctx.processRepository.items).toHaveLength(1);
      expect(
        ctx.documentRepository.items.filter((d) => d.processId === created.process.id),
      ).toHaveLength(1);
      expect(resumed.warnings.some((w) => w.includes('Execução anterior falhou'))).toBe(true);
      expect(lateEvent.status).toBe('COMPLETED');
    });
  });

  describe('chave secundária internetMessageId (docs/14)', () => {
    it('mesma mensagem com id do Graph novo (movida de pasta) é duplicata, não evento novo', async () => {
      const ctx = await buildContext({ cnpjLookup: false });
      const first = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: {
            channel: 'EMAIL',
            externalId: 'id-antigo',
            internetMessageId: '<abc@mail.example>',
            receivedAt: RECEIVED_AT,
          },
        }),
      );

      const second = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: {
            channel: 'EMAIL',
            externalId: 'id-novo-apos-mover',
            internetMessageId: '<abc@mail.example>',
            receivedAt: RECEIVED_AT,
          },
        }),
      );

      expect(second.duplicate).toBe(true);
      expect(second.process.id).toBe(first.process.id);
      expect(ctx.processRepository.items).toHaveLength(1);
      expect(ctx.intakeEventRepository.items).toHaveLength(1);
      expect(first.event.internetMessageId).toBe('<abc@mail.example>');
    });

    it('retomada de FAILED por internetMessageId atualiza o externalId e o kind do evento', async () => {
      const ctx = await buildContext({ cnpjLookup: false });
      // Primeira tentativa: ATTACHMENT com referência inexistente → FAILED.
      await expect(
        ctx.service.attachToProcess(
          ACTOR,
          attachInput({
            source: {
              channel: 'EMAIL',
              externalId: 'id-antigo',
              internetMessageId: '<xyz@mail.example>',
              receivedAt: RECEIVED_AT,
            },
            processRef: 'NAO-EXISTE',
            note: 'x',
          }),
        ),
      ).rejects.toMatchObject({ code: 'PROCESS_REF_NOT_FOUND' });

      // Agente reclassifica como NOVO PROCESSO; a mensagem foi movida (id novo).
      const created = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: {
            channel: 'EMAIL',
            externalId: 'id-novo',
            internetMessageId: '<xyz@mail.example>',
            receivedAt: RECEIVED_AT,
          },
        }),
      );

      expect(created.duplicate).toBe(false);
      expect(ctx.intakeEventRepository.items).toHaveLength(1);
      const event = ctx.intakeEventRepository.items[0];
      expect(event?.externalId).toBe('id-novo');
      expect(event?.kind).toBe('PROCESS');
      expect(event?.status).toBe('COMPLETED');
    });

    it('repassa internetMessageId ao provedor de anexos para o fallback', async () => {
      const ctx = await buildContext({ cnpjLookup: false });

      await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: {
            channel: 'EMAIL',
            externalId: 'msg-1',
            internetMessageId: '<k@mail.example>',
            receivedAt: RECEIVED_AT,
          },
          fetchAttachments: true,
        }),
      );

      expect(ctx.mailAttachmentProvider.optionsSeen[0]?.internetMessageId).toBe('<k@mail.example>');
    });
  });

  describe('anexos baixados pelo servidor (decisão 3)', () => {
    it('baixa anexos do provedor, ignora inline e avisa sobre arquivo acima do limite', async () => {
      const ctx = await buildContext({ cnpjLookup: false });
      ctx.mailAttachmentProvider.respondWith([
        { name: 'invoice.pdf', mimeType: 'application/pdf', content: Buffer.from('pdf') },
        { name: 'logo.png', content: Buffer.from('png'), isInline: true },
        { name: 'grande.zip', content: Buffer.alloc(2048), size: 2048 },
      ]);

      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ fetchAttachments: true }),
      );

      expect(ctx.mailAttachmentProvider.calls).toEqual(['msg-1']);
      expect(ctx.documentRepository.items.map((d) => d.originalName)).toEqual(['invoice.pdf']);
      expect(result.warnings.some((w) => w.includes('grande.zip'))).toBe(true);
    });

    it('responde 503 MAIL_ATTACHMENTS_DISABLED quando o provedor não está configurado', async () => {
      const ctx = await buildContext({ cnpjLookup: false, mailAttachments: false });

      await expect(
        ctx.service.createProcessFromEmail(ACTOR, createInput({ fetchAttachments: true })),
      ).rejects.toMatchObject({ code: 'MAIL_ATTACHMENTS_DISABLED', status: 503 });
      expect(ctx.processRepository.items).toHaveLength(0);
    });

    it('mensagem inexistente responde 404 MAIL_MESSAGE_NOT_FOUND', async () => {
      const ctx = await buildContext({ cnpjLookup: false });
      ctx.mailAttachmentProvider.outcome = { kind: 'MESSAGE_NOT_FOUND' };

      await expect(
        ctx.service.createProcessFromEmail(ACTOR, createInput({ fetchAttachments: true })),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('combina arquivos do multipart com os baixados do provedor', async () => {
      const ctx = await buildContext({ cnpjLookup: false });
      ctx.mailAttachmentProvider.respondWith([{ name: 'do-graph.pdf', content: Buffer.from('g') }]);

      await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ fetchAttachments: true, files: [pdf('do-multipart.pdf')] }),
      );

      expect(ctx.documentRepository.items.map((d) => d.originalName).sort()).toEqual([
        'do-graph.pdf',
        'do-multipart.pdf',
      ]);
    });
  });

  describe('attachToProcess — resolução por referência (decisão 6)', () => {
    async function seedProcess(
      ctx: Context,
      reference: string,
      companyId: string,
    ): Promise<string> {
      const detail = await ctx.processRepository.createWithHistory({
        reference,
        additionalInfo: null,
        clientCompanyId: companyId,
        requestingCompanyId: null,
        currentStageId: ctx.processRepository.stages[0]?.id ?? 'stage',
        createdById: ACTOR,
        source: 'WEB',
        requesterName: null,
        requesterEmail: null,
        receivedAt: null,
      });
      return detail.id;
    }

    it('anexa pelo código do processo (case-insensitive) com source EMAIL e receivedAt', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      const processId = await seedProcess(ctx, 'REF-1', company.id);
      const code = ctx.processRepository.items[0]?.code ?? '';

      const result = await ctx.service.attachToProcess(
        ACTOR,
        attachInput({ processRef: code.toLowerCase(), files: [pdf('bl.pdf')] }),
      );

      expect(result.process.id).toBe(processId);
      expect(result.event.kind).toBe('ATTACHMENT');
      expect(ctx.documentRepository.items[0]?.source).toBe('EMAIL');
      expect(ctx.documentRepository.items[0]?.receivedAt).toEqual(RECEIVED_AT);
      expect(ctx.documentRepository.items[0]?.processId).toBe(processId);
    });

    it('anexa pela referência exata quando é única', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      const processId = await seedProcess(ctx, 'Processo 123123', company.id);
      await seedProcess(ctx, 'Outro 999', company.id);

      const result = await ctx.service.attachToProcess(
        ACTOR,
        attachInput({ processRef: '  processo 123123 ', files: [pdf('di.pdf')] }),
      );

      expect(result.process.id).toBe(processId);
    });

    it('desempata referência duplicada pela organização do domínio do solicitante', async () => {
      const ctx = await buildContext();
      const mine = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      const otherOrg = await ctx.organizationRepository.create({
        name: 'Outra',
        isInternal: false,
      });
      const theirs = await seedCompany(ctx, OTHER_CNPJ, otherOrg.id);
      const expected = await seedProcess(ctx, '123123', mine.id);
      await seedProcess(ctx, '123123', theirs.id);

      const result = await ctx.service.attachToProcess(
        ACTOR,
        attachInput({ processRef: '123123', files: [pdf('x.pdf')] }),
      );

      expect(result.process.id).toBe(expected);
    });

    it('referência ambígua sem desempate responde 409 PROCESS_REF_AMBIGUOUS com candidatos', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      await seedProcess(ctx, '123123', company.id);
      await seedProcess(ctx, '123123', company.id);

      const promise = ctx.service.attachToProcess(
        ACTOR,
        attachInput({ processRef: '123123', files: [pdf('x.pdf')] }),
      );

      await expect(promise).rejects.toMatchObject({ code: 'PROCESS_REF_AMBIGUOUS', status: 409 });
      await promise.catch((error: unknown) => {
        const details = (error as AppError).details as { candidates: unknown[] };
        expect(details.candidates).toHaveLength(2);
      });
      expect(ctx.intakeEventRepository.items[0]?.status).toBe('FAILED');
    });

    it('referência inexistente responde 404 PROCESS_REF_NOT_FOUND com candidatos parciais', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      await seedProcess(ctx, 'IMP-2026-0042 / MSKU123', company.id);

      const promise = ctx.service.attachToProcess(
        ACTOR,
        attachInput({ processRef: 'MSKU123', files: [pdf('x.pdf')] }),
      );

      await expect(promise).rejects.toMatchObject({ code: 'PROCESS_REF_NOT_FOUND', status: 404 });
      await promise.catch((error: unknown) => {
        const details = (error as AppError).details as { candidates: Array<{ reference: string }> };
        expect(details.candidates[0]?.reference).toBe('IMP-2026-0042 / MSKU123');
      });
    });

    it('processId explícito pula a resolução por referência', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      const processId = await seedProcess(ctx, 'qualquer', company.id);

      const result = await ctx.service.attachToProcess(
        ACTOR,
        attachInput({ processId, processRef: 'nao-existe', files: [pdf('x.pdf')] }),
      );

      expect(result.process.id).toBe(processId);
    });

    it('anexa nota do e-mail em additionalInfo com carimbo de remetente e data, gerando histórico', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      const processId = await seedProcess(ctx, 'REF-NOTA', company.id);

      const result = await ctx.service.attachToProcess(
        ACTOR,
        attachInput({ processRef: 'REF-NOTA', note: 'Segue número da LI: 12/3456789-0' }),
      );

      expect(result.process.additionalInfo).toContain(
        '--- E-mail de João <joao@clientex.com.br> em 18/09/2026',
      );
      expect(result.process.additionalInfo).toContain('Segue número da LI: 12/3456789-0');
      const updates = ctx.processRepository.history.filter(
        (entry) => entry.processId === processId && entry.action === 'PROCESS_UPDATED',
      );
      expect(updates).toHaveLength(1);
    });

    it('sem arquivos, sem fetchAttachments e sem nota responde 400', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      await seedProcess(ctx, 'REF-VAZIA', company.id);

      await expect(
        ctx.service.attachToProcess(ACTOR, attachInput({ processRef: 'REF-VAZIA' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('sem processRef nem processId responde 400', async () => {
      const ctx = await buildContext();

      await expect(
        ctx.service.attachToProcess(ACTOR, attachInput({ files: [pdf('x.pdf')] })),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('lookupProcess', () => {
    it('devolve exatos (CODE/REFERENCE) antes dos parciais, sem repetir', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      await ctx.processRepository.createWithHistory({
        reference: '123123',
        additionalInfo: null,
        clientCompanyId: company.id,
        requestingCompanyId: null,
        currentStageId: ctx.processRepository.stages[0]?.id ?? 'stage',
        createdById: ACTOR,
        source: 'WEB',
        requesterName: null,
        requesterEmail: null,
        receivedAt: null,
      });
      await ctx.processRepository.createWithHistory({
        reference: 'Ref 123123-B',
        additionalInfo: null,
        clientCompanyId: company.id,
        requestingCompanyId: null,
        currentStageId: ctx.processRepository.stages[0]?.id ?? 'stage',
        createdById: ACTOR,
        source: 'WEB',
        requesterName: null,
        requesterEmail: null,
        receivedAt: null,
      });

      const matches = await ctx.service.lookupProcess({ refs: ['123123'], limit: 5 });

      expect(matches.map((m) => m.matchedBy)).toEqual(['REFERENCE', 'PARTIAL']);
      expect(new Set(matches.map((m) => m.process.id)).size).toBe(2);

      const code = ctx.processRepository.items[0]?.code ?? '';
      const byCode = await ctx.service.lookupProcess({ refs: [code], limit: 5 });
      expect(byCode[0]?.matchedBy).toBe('CODE');
    });

    it('filtra por documento da empresa e lista por empresa quando não há ref', async () => {
      const ctx = await buildContext();
      const company = await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      const other = await seedCompany(ctx, OTHER_CNPJ, ctx.clientOrganizationId);
      for (const c of [company, other]) {
        await ctx.processRepository.createWithHistory({
          reference: 'MESMA-REF',
          additionalInfo: null,
          clientCompanyId: c.id,
          requestingCompanyId: null,
          currentStageId: ctx.processRepository.stages[0]?.id ?? 'stage',
          createdById: ACTOR,
          source: 'WEB',
          requesterName: null,
          requesterEmail: null,
          receivedAt: null,
        });
      }

      const filtered = await ctx.service.lookupProcess({
        refs: ['MESMA-REF'],
        companyDocument: '11.222.333/0001-81',
        limit: 5,
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.process.clientCompany.cnpj).toBe(VALID_CNPJ);

      const byCompany = await ctx.service.lookupProcess({ companyDocument: OTHER_CNPJ, limit: 5 });
      expect(byCompany).toHaveLength(1);
      expect(byCompany[0]?.matchedBy).toBe('PARTIAL');
      expect(byCompany[0]?.ref).toBeNull();
    });

    it('sem casamento exato, os parciais vêm de todos os refs, cada um com o ref que o trouxe', async () => {
      const ctx = await buildContext();
      const order = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ reference: 'Pedido 4500123' }),
      );
      const invoice = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-b', receivedAt: RECEIVED_AT },
          reference: 'Fatura INV-2026-118',
        }),
      );

      const partial = await ctx.service.lookupProcess({ refs: ['4500', 'INV-2026'], limit: 5 });
      expect(partial.map((m) => [m.process.id, m.matchedBy, m.ref])).toEqual([
        [order.process.id, 'PARTIAL', '4500'],
        [invoice.process.id, 'PARTIAL', 'INV-2026'],
      ]);
    });
  });

  describe('índice de identificadores e retaguarda do iLog (docs/15)', () => {
    it('createProcessFromEmail grava no índice os identificadores da referência e os informados', async () => {
      const ctx = await buildContext();
      const result = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          reference: '230/26 - DANGB26080406',
          identifiers: ['MSKU1234567', 'dangb26080406', 'x'],
        }),
      );
      const identifiers = await ctx.processIdentifierRepository.listByProcess(result.process.id);
      expect(identifiers.map((i) => [i.kind, i.normalized, i.source])).toEqual([
        ['OTHER', '23026DANGB26080406', 'EMAIL'],
        ['OPUS_NUMBER', '23026', 'EMAIL'],
        ['OTHER', 'DANGB26080406', 'EMAIL'],
        ['CONTAINER', 'MSKU1234567', 'EMAIL'],
      ]);
      expect(result.process.identifiers.map((i) => i.value)).toContain('MSKU1234567');
    });

    it('lookupProcess casa pelo índice (exato por normalizado) e devolve o kind do identificador', async () => {
      const ctx = await buildContext();
      const created = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ reference: 'Novo processo 230/26', identifiers: ['DANGB26080406'] }),
      );

      const byHbl = await ctx.service.lookupProcess({ refs: ['dangb 26080406'], limit: 5 });
      expect(byHbl.map((m) => [m.process.id, m.matchedBy])).toEqual([
        [created.process.id, 'OTHER'],
      ]);

      const byNumber = await ctx.service.lookupProcess({ refs: ['230-26'], limit: 5 });
      expect(byNumber[0]).toMatchObject({ matchedBy: 'OPUS_NUMBER' });

      // Sem iLog configurado, nada é consultado fora: um identificador desconhecido só não casa.
      expect(await ctx.service.lookupProcess({ refs: ['NAOEXISTE99'], limit: 5 })).toEqual([]);
      expect(ctx.ilogSource.calls.findByIdentifier).toBe(0);
    });

    it('lookupProcess consulta o iLog só quando o índice falha, e espelha o processo na hora', async () => {
      const ctx = await buildContext({ ilog: true });
      ctx.ilogSource.processes.set(
        350368,
        makeIlogProcess({
          ilogProcessId: 350368,
          number: '31435/26',
          clientRef: 'DANGB26080406',
          houseBl: 'DANGB26080406',
          ce: '132605301737430',
        }),
      );

      const found = await ctx.service.lookupProcess({ refs: ['31435/26'], limit: 5 });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ matchedBy: 'OPUS_NUMBER' });
      expect(found[0]?.process).toMatchObject({ ilogNumber: '31435/26', source: 'ILOG' });
      expect(ctx.ilogSource.calls.findByIdentifier).toBe(1);
      expect(ctx.companyRepository.items[0]).toMatchObject({ cnpj: '12345678000195' });

      // Agora está no índice: o iLog não é consultado de novo, nem por outro identificador do mesmo processo.
      const again = await ctx.service.lookupProcess({ refs: ['132605301737430'], limit: 5 });
      expect(again.map((m) => m.matchedBy)).toEqual(['CE']);
      expect(ctx.ilogSource.calls.findByIdentifier).toBe(1);

      // Nome de empresa não é identificador: não vai ao iLog.
      await ctx.service.lookupProcess({ refs: ['Casa e Novidade'], limit: 5 });
      expect(ctx.ilogSource.calls.findByIdentifier).toBe(1);
    });

    it('com vários refs vale o primeiro que casar no índice; o iLog só é consultado se nenhum casar', async () => {
      const ctx = await buildContext({ ilog: true });
      const created = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ reference: 'Pré-alerta', identifiers: ['DANGB26080406', 'MSKU1234567'] }),
      );

      // O número da Opus não está no índice, o HBL está: casa pelo HBL, sem ir ao iLog.
      const byHbl = await ctx.service.lookupProcess({
        refs: ['31435/26', 'DANGB26080406', 'MSKU1234567'],
        limit: 5,
      });
      expect(byHbl.map((m) => [m.process.id, m.ref])).toEqual([
        [created.process.id, 'DANGB26080406'],
      ]);
      expect(byHbl[0]?.matchedBy).not.toBe('PARTIAL');
      expect(ctx.ilogSource.calls.findByIdentifier).toBe(0);

      // Nenhum no índice: iLog na ordem dos refs, parando no primeiro que achar.
      ctx.ilogSource.processes.set(
        7,
        makeIlogProcess({ ilogProcessId: 7, number: '31440/26', houseBl: 'ZZZ987654' }),
      );
      const viaIlog = await ctx.service.lookupProcess({
        refs: ['NAOEXISTE99', 'ZZZ987654', '31440/26'],
        limit: 5,
      });
      expect(viaIlog[0]).toMatchObject({ ref: 'ZZZ987654', process: { ilogNumber: '31440/26' } });
      expect(ctx.ilogSource.calls.findByIdentifier).toBe(2);
    });

    it('com o iLog fora do ar, vários refs custam uma tentativa só e o lookup avisa que o iLog está indisponível', async () => {
      const off = await buildContext();
      expect(off.service.ilogLookupAvailable()).toBeNull();

      const ctx = await buildContext({ ilog: true });
      expect(ctx.service.ilogLookupAvailable()).toBe(true);
      ctx.ilogSource.failWith = new Error('connect ETIMEDOUT');

      const matches = await ctx.service.lookupProcess({
        refs: ['30611/26', 'DUAP-009126', '26IDL-040', 'DANGB26070125'],
        limit: 5,
      });
      expect(matches).toEqual([]);
      expect(ctx.ilogSource.calls.findByIdentifier).toBe(1);
      expect(ctx.service.ilogLookupAvailable()).toBe(false);
    });

    it('attachToProcess resolve o processo por identificador do índice e, se preciso, pelo iLog', async () => {
      const ctx = await buildContext({ ilog: true });
      const created = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ reference: 'Pré-alerta', identifiers: ['HBL-123456'] }),
      );
      const attached = await ctx.service.attachToProcess(
        ACTOR,
        attachInput({ processRef: 'hbl 123456', files: [pdf('bl.pdf')] }),
      );
      expect(attached.process.id).toBe(created.process.id);
      expect(ctx.ilogSource.calls.findByIdentifier).toBe(0);

      ctx.ilogSource.processes.set(
        7,
        makeIlogProcess({ ilogProcessId: 7, number: '31440/26', houseBl: 'ZZZ987654' }),
      );
      const viaIlog = await ctx.service.attachToProcess(
        ACTOR,
        attachInput({
          source: { channel: 'EMAIL', externalId: 'msg-3', receivedAt: RECEIVED_AT },
          processRef: 'ZZZ987654',
          files: [pdf('bl2.pdf')],
        }),
      );
      expect(viaIlog.process).toMatchObject({ ilogNumber: '31440/26', source: 'ILOG' });
      expect(
        ctx.documentRepository.items.filter((d) => d.processId === viaIlog.process.id),
      ).toHaveLength(1);
      expect(ctx.ilogSource.calls.findByIdentifier).toBe(1);
    });

    it('attachToProcess com identificador em dois processos de empresas diferentes é ambíguo', async () => {
      const ctx = await buildContext();
      const other = await seedCompany(ctx, OTHER_CNPJ, ctx.clientOrganizationId);
      await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ reference: 'A', identifiers: ['CONT-000111'] }),
      );
      await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-x', receivedAt: RECEIVED_AT },
          company: { document: other.cnpj },
          reference: 'B',
          identifiers: ['CONT-000111'],
        }),
      );
      await expect(
        ctx.service.attachToProcess(
          ACTOR,
          attachInput({ processRef: 'CONT-000111', files: [pdf('a.pdf')] }),
        ),
      ).rejects.toMatchObject({ code: 'PROCESS_REF_AMBIGUOUS' });
    });

    it('createProcessFromEmail não duplica: mesmo identificador na mesma empresa vira complemento', async () => {
      const ctx = await buildContext();
      const first = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ reference: '230/26', identifiers: ['DANGB26080406'] }),
      );
      const second = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-9', subject: 'BL', receivedAt: RECEIVED_AT },
          reference: 'BL DANGB26080406',
          additionalInfo: 'Segue o BL original.',
          files: [pdf('bl.pdf')],
        }),
      );
      expect(second.process.id).toBe(first.process.id);
      expect(second.event.kind).toBe('ATTACHMENT');
      expect(
        ctx.documentRepository.items.filter((d) => d.processId === first.process.id),
      ).toHaveLength(1);
      expect(second.warnings.some((w) => w.includes('Já existia o processo'))).toBe(true);
      expect(second.process.additionalInfo).toContain('Segue o BL original.');
      expect(ctx.processRepository.items).toHaveLength(1);

      // Empresa diferente com o mesmo identificador: abre outro (não é o mesmo embarque).
      const other = await seedCompany(ctx, OTHER_CNPJ, ctx.clientOrganizationId);
      const third = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({
          source: { channel: 'EMAIL', externalId: 'msg-10', receivedAt: RECEIVED_AT },
          company: { document: other.cnpj },
          reference: 'DANGB26080406',
        }),
      );
      expect(third.process.id).not.toBe(first.process.id);
      expect(third.event.kind).toBe('PROCESS');
    });

    it('addReferences alimenta o índice mesmo quando a referência está cheia', async () => {
      const ctx = await buildContext();
      const created = await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ reference: 'x'.repeat(250) }),
      );
      const result = await ctx.service.attachToProcess(
        ACTOR,
        attachInput({ processId: created.process.id, addReferences: ['MSKU7654321'] }),
      );
      expect(result.warnings.some((w) => w.includes('Referência cheia'))).toBe(true);
      const match = await ctx.service.lookupProcess({ refs: ['MSKU7654321'], limit: 5 });
      expect(match.map((m) => [m.process.id, m.matchedBy])).toEqual([
        [created.process.id, 'CONTAINER'],
      ]);
    });
  });

  describe('skipEmail e getCursor — pasta de intake sem mover e-mails (decisão 9)', () => {
    it('registra IGNORED/ESCALATED como evento COMPLETED com motivo, sem processo', async () => {
      const ctx = await buildContext();

      const ignored = await ctx.service.skipEmail(ACTOR, {
        source: { channel: 'EMAIL', externalId: 'msg-news', receivedAt: RECEIVED_AT },
        outcome: 'IGNORED',
        reason: 'Newsletter do terminal.',
      });
      expect(ignored.duplicate).toBe(false);
      expect(ignored.event.kind).toBe('IGNORED');
      expect(ignored.event.status).toBe('COMPLETED');
      expect(ignored.event.processId).toBeNull();
      expect(ignored.event.requesterEmail).toBeNull();
      expect(ignored.event.result?.reason).toBe('Newsletter do terminal.');

      const escalated = await ctx.service.skipEmail(ACTOR, {
        source: {
          channel: 'EMAIL',
          externalId: 'msg-esc',
          subject: 'Dúvida',
          receivedAt: RECEIVED_AT,
        },
        requester: { email: 'joao@clientex.com.br', name: 'João' },
        outcome: 'ESCALATED',
        reason: 'Sem CNPJ identificável.',
      });
      expect(escalated.event.kind).toBe('ESCALATED');
      expect(escalated.event.requesterEmail).toBe('joao@clientex.com.br');
      expect(ctx.processRepository.items).toHaveLength(0);
    });

    it('repetir o skip responde duplicate: true e nunca sobrescreve um processo já criado', async () => {
      const ctx = await buildContext();
      await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);

      const created = await ctx.service.createProcessFromEmail(ACTOR, createInput());
      const skipAfterProcess = await ctx.service.skipEmail(ACTOR, {
        source: { channel: 'EMAIL', externalId: 'msg-1', receivedAt: RECEIVED_AT },
        outcome: 'IGNORED',
        reason: 'Engano.',
      });
      expect(skipAfterProcess.duplicate).toBe(true);
      expect(skipAfterProcess.event.kind).toBe('PROCESS');
      expect(skipAfterProcess.event.processId).toBe(created.process.id);

      await ctx.service.skipEmail(ACTOR, {
        source: { channel: 'EMAIL', externalId: 'msg-x', receivedAt: RECEIVED_AT },
        outcome: 'IGNORED',
        reason: 'Ruído.',
      });
      const again = await ctx.service.skipEmail(ACTOR, {
        source: { channel: 'EMAIL', externalId: 'msg-x', receivedAt: RECEIVED_AT },
        outcome: 'ESCALATED',
        reason: 'Mudei de ideia.',
      });
      expect(again.duplicate).toBe(true);
      expect(again.event.kind).toBe('IGNORED');
    });

    it('escalar um evento FAILED (ex.: referência não encontrada) o conclui como ESCALATED', async () => {
      const ctx = await buildContext();
      await expect(
        ctx.service.attachToProcess(ACTOR, attachInput({ processRef: 'NAO-EXISTE' })),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect((await ctx.intakeEventRepository.findByExternalId('EMAIL', 'msg-2'))?.status).toBe(
        'FAILED',
      );

      const result = await ctx.service.skipEmail(ACTOR, {
        source: { channel: 'EMAIL', externalId: 'msg-2', receivedAt: RECEIVED_AT },
        requester: { email: 'joao@clientex.com.br' },
        outcome: 'ESCALATED',
        reason: 'PROCESS_REF_NOT_FOUND sem candidato.',
      });
      expect(result.duplicate).toBe(false);
      expect(result.event.status).toBe('COMPLETED');
      expect(result.event.kind).toBe('ESCALATED');
      expect(result.event.errorMessage).toBeNull();
      expect(ctx.intakeEventRepository.items).toHaveLength(1);
    });

    it('evento PROCESSING responde 409 INTAKE_IN_PROGRESS também no skip', async () => {
      const ctx = await buildContext();
      await ctx.intakeEventRepository.claim({
        channel: 'EMAIL',
        externalId: 'msg-busy',
        internetMessageId: null,
        kind: 'PROCESS',
        status: 'PROCESSING',
        subject: null,
        requesterName: null,
        requesterEmail: null,
        receivedAt: RECEIVED_AT,
        createdById: ACTOR,
      });
      await expect(
        ctx.service.skipEmail(ACTOR, {
          source: { channel: 'EMAIL', externalId: 'msg-busy', receivedAt: RECEIVED_AT },
          outcome: 'IGNORED',
          reason: 'Ruído.',
        }),
      ).rejects.toMatchObject({ code: 'INTAKE_IN_PROGRESS' });
    });

    it('skipEmails registra cada item em ordem; erro de domínio de um item não derruba os outros', async () => {
      const ctx = await buildContext();
      await ctx.intakeEventRepository.claim({
        channel: 'EMAIL',
        externalId: 'msg-busy',
        internetMessageId: null,
        kind: 'PROCESS',
        status: 'PROCESSING',
        subject: null,
        requesterName: null,
        requesterEmail: null,
        receivedAt: RECEIVED_AT,
        createdById: ACTOR,
      });
      await ctx.service.skipEmail(ACTOR, {
        source: { channel: 'EMAIL', externalId: 'msg-old', receivedAt: RECEIVED_AT },
        outcome: 'IGNORED',
        reason: 'Ruído.',
      });
      const source = (externalId: string): SkipIntakeInput['source'] => ({
        channel: 'EMAIL',
        externalId,
        receivedAt: RECEIVED_AT,
      });

      const results = await ctx.service.skipEmails(ACTOR, [
        { source: source('msg-a'), outcome: 'IGNORED', reason: 'Confirmação de recebimento.' },
        { source: source('msg-busy'), outcome: 'IGNORED', reason: 'Ruído.' },
        { source: source('msg-old'), outcome: 'ESCALATED', reason: 'Repetido.' },
        {
          source: source('msg-b'),
          requester: { email: 'agente@cargo.com' },
          outcome: 'ESCALATED',
          reason: 'vários embarques no mesmo e-mail',
        },
      ]);
      expect(results.map((r) => [r.externalId, r.ok, r.ok ? r.duplicate : r.error.code])).toEqual([
        ['msg-a', true, false],
        ['msg-busy', false, 'INTAKE_IN_PROGRESS'],
        ['msg-old', true, true],
        ['msg-b', true, false],
      ]);
      expect(await ctx.intakeEventRepository.findByExternalId('EMAIL', 'msg-b')).toMatchObject({
        kind: 'ESCALATED',
        status: 'COMPLETED',
        requesterEmail: 'agente@cargo.com',
      });
      expect((await ctx.intakeEventRepository.findByExternalId('EMAIL', 'msg-old'))?.kind).toBe(
        'IGNORED',
      );

      // Erro que não é de domínio (banco fora) derruba o lote: repetir é seguro.
      jest.spyOn(ctx.intakeEventRepository, 'claim').mockRejectedValueOnce(new Error('banco fora'));
      await expect(
        ctx.service.skipEmails(ACTOR, [
          { source: source('msg-c'), outcome: 'IGNORED', reason: 'Ruído.' },
        ]),
      ).rejects.toThrow('banco fora');
    });

    it('e-mail pulado pode ser processado depois: o evento é reaberto, não duplicado', async () => {
      const ctx = await buildContext();
      await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);
      await ctx.service.skipEmail(ACTOR, {
        source: { channel: 'EMAIL', externalId: 'msg-1', receivedAt: RECEIVED_AT },
        outcome: 'ESCALATED',
        reason: 'Faltava CNPJ; pessoa confirmou depois.',
      });

      const result = await ctx.service.createProcessFromEmail(ACTOR, createInput());
      expect(result.duplicate).toBe(false);
      expect(result.event.kind).toBe('PROCESS');
      expect(result.event.status).toBe('COMPLETED');
      expect(result.event.result?.reason).toBeNull();
      expect(ctx.intakeEventRepository.items).toHaveLength(1);
      expect(ctx.processRepository.items).toHaveLength(1);
    });

    it('sem ponteiro gravado, o cursor é deduzido do último examinado (COMPLETED ou FAILED); PROCESSING não conta', async () => {
      const ctx = await buildContext();
      await seedCompany(ctx, VALID_CNPJ, ctx.clientOrganizationId);

      expect(await ctx.service.getCursor('EMAIL')).toEqual({
        channel: 'EMAIL',
        receivedAt: null,
        externalId: null,
        source: 'NONE',
      });

      const t1 = new Date('2026-09-21T10:00:00.000Z');
      const t2 = new Date('2026-09-21T11:00:00.000Z');
      const t3 = new Date('2026-09-21T12:00:00.000Z');
      const t4 = new Date('2026-09-21T13:00:00.000Z');
      await ctx.service.createProcessFromEmail(
        ACTOR,
        createInput({ source: { channel: 'EMAIL', externalId: 'a', receivedAt: t2 } }),
      );
      await ctx.service.skipEmail(ACTOR, {
        source: { channel: 'EMAIL', externalId: 'b', receivedAt: t1 },
        outcome: 'IGNORED',
        reason: 'Ruído.',
      });
      expect((await ctx.service.getCursor('EMAIL')).receivedAt).toEqual(t2);

      await expect(
        ctx.service.attachToProcess(
          ACTOR,
          attachInput({
            source: { channel: 'EMAIL', externalId: 'c', receivedAt: t3 },
            processRef: 'NAO-EXISTE',
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
      await ctx.intakeEventRepository.claim({
        channel: 'EMAIL',
        externalId: 'd',
        internetMessageId: null,
        kind: 'PROCESS',
        status: 'PROCESSING',
        subject: null,
        requesterName: null,
        requesterEmail: null,
        receivedAt: t4,
        createdById: ACTOR,
      });

      const cursor = await ctx.service.getCursor('EMAIL');
      expect(cursor).toEqual({
        channel: 'EMAIL',
        receivedAt: t3,
        externalId: 'c',
        source: 'EVENTS',
      });
    });

    it('ponteiro gravado vale sobre os eventos e só anda para a frente', async () => {
      const ctx = await buildContext();
      const t1 = new Date('2026-09-21T10:00:00.000Z');
      const t2 = new Date('2026-09-21T11:00:00.000Z');
      const t3 = new Date('2026-09-21T12:00:00.000Z');

      // Evento mais novo que o ponteiro não "puxa" o cursor: o agente é quem avança.
      await ctx.service.skipEmail(ACTOR, {
        source: { channel: 'EMAIL', externalId: 'novo', receivedAt: t3 },
        outcome: 'IGNORED',
        reason: 'Ruído.',
      });
      const first = await ctx.service.advanceCursor({
        channel: 'EMAIL',
        receivedAt: t2,
        externalId: 'pagina-1',
      });
      expect(first.advanced).toBe(true);
      expect(await ctx.service.getCursor('EMAIL')).toEqual({
        channel: 'EMAIL',
        receivedAt: t2,
        externalId: 'pagina-1',
        source: 'STORED',
      });

      // Valor mais antigo (execução atrasada) é ignorado.
      const stale = await ctx.service.advanceCursor({ channel: 'EMAIL', receivedAt: t1 });
      expect(stale.advanced).toBe(false);
      expect(stale.cursor.receivedAt).toEqual(t2);

      const same = await ctx.service.advanceCursor({ channel: 'EMAIL', receivedAt: t2 });
      expect(same.advanced).toBe(false);

      const forward = await ctx.service.advanceCursor({ channel: 'EMAIL', receivedAt: t3 });
      expect(forward.advanced).toBe(true);
      expect(forward.cursor.externalId).toBeNull();
    });
  });
});
