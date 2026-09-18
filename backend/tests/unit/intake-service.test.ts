import { FakeCnpjLookupProvider } from '../helpers/fakes/fake-cnpj-lookup-provider';
import { FakeMailAttachmentProvider } from '../helpers/fakes/fake-mail-attachment-provider';
import { FakeStorageProvider } from '../helpers/fakes/fake-storage-provider';
import { InMemoryCompanyRepository } from '../helpers/fakes/in-memory-company-repository';
import { InMemoryDocumentRepository } from '../helpers/fakes/in-memory-document-repository';
import { InMemoryEmailDomainRepository } from '../helpers/fakes/in-memory-email-domain-repository';
import { InMemoryIntakeEventRepository } from '../helpers/fakes/in-memory-intake-event-repository';
import { InMemoryKanbanStageRepository } from '../helpers/fakes/in-memory-kanban-stage-repository';
import { InMemoryOrganizationRepository } from '../helpers/fakes/in-memory-organization-repository';
import { InMemoryProcessRepository } from '../helpers/fakes/in-memory-process-repository';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import type { Company } from '@/domain/entities/company';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/domain/errors/app-error';
import { DocumentService } from '@/services/document-service';
import type { AttachIntakeInput, CreateProcessIntakeInput } from '@/services/intake-service';
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
  processRepository: InMemoryProcessRepository;
  companyRepository: InMemoryCompanyRepository;
  organizationRepository: InMemoryOrganizationRepository;
  emailDomainRepository: InMemoryEmailDomainRepository;
  documentRepository: InMemoryDocumentRepository;
  cnpjLookupProvider: FakeCnpjLookupProvider;
  mailAttachmentProvider: FakeMailAttachmentProvider;
  clientOrganizationId: string;
}

async function buildContext(
  overrides: { cnpjLookup?: boolean; mailAttachments?: boolean } = {},
): Promise<Context> {
  const intakeEventRepository = new InMemoryIntakeEventRepository();
  const processRepository = new InMemoryProcessRepository();
  const companyRepository = new InMemoryCompanyRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const emailDomainRepository = new InMemoryEmailDomainRepository();
  const documentRepository = new InMemoryDocumentRepository();
  const stageRepository = new InMemoryKanbanStageRepository();
  const userRepository = new InMemoryUserRepository();
  const cnpjLookupProvider = new FakeCnpjLookupProvider();
  const mailAttachmentProvider = new FakeMailAttachmentProvider();

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
    companyRepository,
    stageRepository,
    userRepository,
  });
  const documentService = new DocumentService({
    documentRepository,
    processRepository,
    storageProvider: new FakeStorageProvider(),
    maxFilesPerRequest: 10,
  });

  const service = new IntakeService({
    intakeEventRepository,
    processRepository,
    companyRepository,
    organizationRepository,
    emailDomainRepository,
    processService,
    documentService,
    cnpjLookupProvider: overrides.cnpjLookup === false ? null : cnpjLookupProvider,
    mailAttachmentProvider: overrides.mailAttachments === false ? null : mailAttachmentProvider,
    maxAttachmentBytes: 1024,
  });

  return {
    service,
    intakeEventRepository,
    processRepository,
    companyRepository,
    organizationRepository,
    emailDomainRepository,
    documentRepository,
    cnpjLookupProvider,
    mailAttachmentProvider,
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

      const matches = await ctx.service.lookupProcess({ ref: '123123', limit: 5 });

      expect(matches.map((m) => m.matchedBy)).toEqual(['REFERENCE', 'PARTIAL']);
      expect(new Set(matches.map((m) => m.process.id)).size).toBe(2);

      const code = ctx.processRepository.items[0]?.code ?? '';
      const byCode = await ctx.service.lookupProcess({ ref: code, limit: 5 });
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
        ref: 'MESMA-REF',
        companyDocument: '11.222.333/0001-81',
        limit: 5,
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.process.clientCompany.cnpj).toBe(VALID_CNPJ);

      const byCompany = await ctx.service.lookupProcess({ companyDocument: OTHER_CNPJ, limit: 5 });
      expect(byCompany).toHaveLength(1);
      expect(byCompany[0]?.matchedBy).toBe('PARTIAL');
    });
  });
});
