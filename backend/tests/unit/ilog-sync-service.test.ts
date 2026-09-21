import { FakeIlogProcessSource, makeIlogProcess } from '../helpers/fakes/fake-ilog-process-source';
import { FakeRealtimeProvider } from '../helpers/fakes/fake-realtime-provider';
import { InMemoryCompanyRepository } from '../helpers/fakes/in-memory-company-repository';
import { InMemoryEmailDomainRepository } from '../helpers/fakes/in-memory-email-domain-repository';
import { InMemoryIlogSyncStateRepository } from '../helpers/fakes/in-memory-ilog-sync-state-repository';
import { InMemoryKanbanStageRepository } from '../helpers/fakes/in-memory-kanban-stage-repository';
import { InMemoryOrganizationRepository } from '../helpers/fakes/in-memory-organization-repository';
import { InMemoryProcessIdentifierRepository } from '../helpers/fakes/in-memory-process-identifier-repository';
import { InMemoryProcessRepository } from '../helpers/fakes/in-memory-process-repository';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import type { Company } from '@/domain/entities/company';
import { AppError } from '@/domain/errors/app-error';
import { IlogSyncService, identifiersOf, referenceOf } from '@/services/ilog-sync-service';
import { ProcessService } from '@/services/process-service';

const ALL = { kind: 'ALL' } as const;

interface Context {
  service: IlogSyncService;
  source: FakeIlogProcessSource;
  syncStateRepository: InMemoryIlogSyncStateRepository;
  processRepository: InMemoryProcessRepository;
  processIdentifierRepository: InMemoryProcessIdentifierRepository;
  companyRepository: InMemoryCompanyRepository;
  organizationRepository: InMemoryOrganizationRepository;
  emailDomainRepository: InMemoryEmailDomainRepository;
  userRepository: InMemoryUserRepository;
  processService: ProcessService;
  realtimeProvider: FakeRealtimeProvider;
  adminId: string;
  warnings: string[];
}

async function buildContext(
  options: { actorEmail?: string | null; admin?: boolean } = {},
): Promise<Context> {
  const source = new FakeIlogProcessSource();
  const syncStateRepository = new InMemoryIlogSyncStateRepository();
  const processRepository = new InMemoryProcessRepository();
  const processIdentifierRepository = new InMemoryProcessIdentifierRepository(
    processRepository.identifiers,
    (processId) => processRepository.items.some((p) => p.id === processId && p.deletedAt === null),
  );
  const companyRepository = new InMemoryCompanyRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const emailDomainRepository = new InMemoryEmailDomainRepository();
  const userRepository = new InMemoryUserRepository();
  const stageRepository = new InMemoryKanbanStageRepository();
  const realtimeProvider = new FakeRealtimeProvider();

  const stage = await stageRepository.create({
    name: 'Entrada',
    color: '#1677ff',
    isFinal: false,
    order: 0,
  });
  processRepository.stages.push({ ...stage });

  let adminId = '';
  if (options.admin !== false) {
    const admin = await userRepository.create({
      name: 'Admin',
      email: 'admin@opusce.com.br',
      passwordHash: null,
      role: 'ADMIN',
      status: 'ACTIVE',
      accessScope: 'ORGANIZATION',
      organizationId: null,
    });
    adminId = admin.id;
    processRepository.users.push({ id: admin.id, name: admin.name, email: admin.email });
  }

  const processService = new ProcessService({
    processRepository,
    processIdentifierRepository,
    companyRepository,
    stageRepository,
    userRepository,
    realtimeProvider,
  });

  const warnings: string[] = [];
  const service = new IlogSyncService({
    source,
    syncStateRepository,
    processRepository,
    processIdentifierRepository,
    companyRepository,
    organizationRepository,
    emailDomainRepository,
    userRepository,
    processService,
    logger: {
      info: () => undefined,
      warn: (_payload, message) => {
        warnings.push(message);
      },
    },
    options: { backfillDays: 90, changelogLimit: 100, actorEmail: options.actorEmail ?? null },
  });

  return {
    service,
    source,
    syncStateRepository,
    processRepository,
    processIdentifierRepository,
    companyRepository,
    organizationRepository,
    emailDomainRepository,
    userRepository,
    processService,
    realtimeProvider,
    adminId,
    warnings,
  };
}

/** Empresa local já cadastrada (com ou sem CNPJ), refletida também no fake de processos. */
async function seedCompany(
  ctx: Context,
  data: {
    cnpj: string | null;
    legalName: string;
    organizationId?: string;
    ilogCompanyId?: number | null;
  },
): Promise<Company> {
  const organizationId =
    data.organizationId ??
    (await ctx.organizationRepository.create({ name: data.legalName, isInternal: false })).id;
  const company = await ctx.companyRepository.create({
    cnpj: data.cnpj,
    documentType: data.cnpj ? 'CNPJ' : null,
    legalName: data.legalName,
    tradeName: null,
    organizationId,
    ilogCompanyId: data.ilogCompanyId ?? null,
  });
  ctx.processRepository.companies.push({
    id: company.id,
    cnpj: company.cnpj,
    legalName: company.legalName,
  });
  return company;
}

describe('identifiersOf / referenceOf', () => {
  it('lista todos os identificadores que o iLog conhece, com o kind certo', () => {
    const process = makeIlogProcess({
      ilogProcessId: 1,
      number: '31435/26',
      clientRef: 'SWT 0021/26',
      houseBl: 'DANGB26080406',
      masterBl: 'MAEU123',
      di: '26BR00017973636',
      ce: '132605301737430',
      containers: ['MSKU1234567'],
      invoices: ['INV-2026-01'],
    });
    expect(identifiersOf(process)).toEqual([
      { kind: 'OPUS_NUMBER', value: '31435/26' },
      { kind: 'CLIENT_REF', value: 'SWT 0021/26' },
      { kind: 'HBL', value: 'DANGB26080406' },
      { kind: 'MBL', value: 'MAEU123' },
      { kind: 'DI', value: '26BR00017973636' },
      { kind: 'CE', value: '132605301737430' },
      { kind: 'CONTAINER', value: 'MSKU1234567' },
      { kind: 'INVOICE', value: 'INV-2026-01' },
    ]);
  });

  it('monta a referência com a identificação do cliente e o HBL só quando são diferentes', () => {
    expect(
      referenceOf(
        makeIlogProcess({ ilogProcessId: 1, clientRef: 'DANGB26080406', houseBl: 'DANGB26080406' }),
      ),
    ).toBe('DANGB26080406');
    expect(
      referenceOf(
        makeIlogProcess({ ilogProcessId: 1, clientRef: 'SWT 0021/26', houseBl: 'XYZ123' }),
      ),
    ).toBe('SWT 0021/26 / XYZ123');
    expect(referenceOf(makeIlogProcess({ ilogProcessId: 1, number: '31435/26' }))).toBe('31435/26');
  });
});

describe('IlogSyncService.runOnce — backfill e incremental (docs/15, seção 5.2)', () => {
  it('backfill inicial: cria processos com origem ILOG, empresa/organização reais, domínios exclusivos e índice', async () => {
    const ctx = await buildContext();
    ctx.source.processes.set(
      350368,
      makeIlogProcess({
        ilogProcessId: 350368,
        number: '31435/26',
        clientRef: 'DANGB26080406',
        houseBl: 'DANGB26080406',
        ce: '132605301737430',
        importer: {
          ilogCompanyId: 569,
          legalName: 'CASA E NOVIDADE COMERCIO LTDA',
          tradeName: 'CASA & NOVIDADE',
          cnpj: '12345678000195',
          contactDomains: ['casaenovidade.com.br', 'gmail.com', 'despachante.com.br'],
        },
      }),
    );
    ctx.source.sharedDomains.push('despachante.com.br');

    const result = await ctx.service.runOnce();

    expect(result).toMatchObject({
      backfilled: true,
      examined: 1,
      created: 1,
      companiesCreated: 1,
      domainsRegistered: 1,
      lastChangelogAt: '2026-09-21 12:00:00',
    });

    const process = ctx.processRepository.items[0];
    expect(process).toMatchObject({
      source: 'ILOG',
      reference: 'DANGB26080406',
      ilogProcessId: 350368,
      ilogNumber: '31435/26',
      createdById: ctx.adminId,
    });
    expect(process?.ilogSyncedAt).toBeInstanceOf(Date);

    const company = ctx.companyRepository.items[0];
    expect(company).toMatchObject({
      cnpj: '12345678000195',
      documentType: 'CNPJ',
      legalName: 'CASA E NOVIDADE COMERCIO LTDA',
      tradeName: 'CASA & NOVIDADE',
      ilogCompanyId: 569,
    });
    expect(ctx.organizationRepository.items[0]).toMatchObject({
      name: 'CASA & NOVIDADE',
      isInternal: false,
    });
    // Só o domínio exclusivo e corporativo vira EmailDomain, sem aprovação automática.
    expect(ctx.emailDomainRepository.items.map((d) => [d.domain, d.autoApprove])).toEqual([
      ['casaenovidade.com.br', false],
    ]);

    const identifiers = await ctx.processIdentifierRepository.listByProcess(process?.id ?? '');
    expect(identifiers.map((i) => [i.kind, i.normalized, i.source])).toEqual([
      ['OPUS_NUMBER', '3143526', 'ILOG'],
      ['CLIENT_REF', 'DANGB26080406', 'ILOG'],
      ['HBL', 'DANGB26080406', 'ILOG'],
      ['CE', '132605301737430', 'ILOG'],
    ]);

    // Tempo real: o board recebe o processo espelhado.
    expect(ctx.realtimeProvider.processEvents.map((e) => e.event.name)).toEqual([
      'process:created',
    ]);

    const state = await ctx.syncStateRepository.get('ILOG');
    expect(state).toMatchObject({
      backfillDone: true,
      lastChangelogAt: '2026-09-21 12:00:00',
      lastError: null,
    });
    expect(state?.lastRunAt).toBeInstanceOf(Date);
  });

  it('backfill só traz processos em aberto; encerrados/cancelados alterados depois não entram no funil', async () => {
    const ctx = await buildContext();
    ctx.source.processes.set(1, makeIlogProcess({ ilogProcessId: 1 }));
    ctx.source.processes.set(
      2,
      makeIlogProcess({ ilogProcessId: 2, closedAt: new Date('2026-09-01T03:00:00Z') }),
    );
    ctx.source.processes.set(
      3,
      makeIlogProcess({ ilogProcessId: 3, cancelledAt: new Date('2026-09-01T03:00:00Z') }),
    );
    ctx.source.changes.push({ ilogProcessId: 2, changedAt: '2026-09-21 12:30:00' });

    const first = await ctx.service.runOnce();
    expect(first).toMatchObject({ created: 1, skipped: 1, examined: 2 });
    expect(ctx.processRepository.items).toHaveLength(1);
    expect(first.lastChangelogAt).toBe('2026-09-21 12:30:00');
  });

  it('incremental: relê só o que mudou no changelog, atualiza identificadores sem duplicar e avança o cursor', async () => {
    const ctx = await buildContext();
    const process = makeIlogProcess({ ilogProcessId: 10, clientRef: 'REF-1' });
    ctx.source.processes.set(10, process);
    await ctx.service.runOnce();
    expect(ctx.source.calls.listOpen).toBe(1);
    const created = ctx.processRepository.items[0];
    expect(created).toBeDefined();

    // O iLog ganha o HBL e a DI depois; nada mais muda.
    ctx.source.processes.set(10, { ...process, houseBl: 'HBL-999', di: '26BR00017973636' });
    ctx.source.changes.push({ ilogProcessId: 10, changedAt: '2026-09-21 12:05:00' });

    const second = await ctx.service.runOnce();
    expect(second).toMatchObject({
      backfilled: false,
      examined: 1,
      updated: 1,
      created: 0,
      lastChangelogAt: '2026-09-21 12:05:00',
    });
    expect(ctx.source.calls.listOpen).toBe(1);
    expect(ctx.processRepository.items).toHaveLength(1);

    const identifiers = await ctx.processIdentifierRepository.listByProcess(created?.id ?? '');
    expect(identifiers.map((i) => i.value).sort()).toEqual(
      ['26BR00017973636', '30010/26', 'HBL-999', 'REF-1'].sort(),
    );
    // A referência do espelhado acompanha o iLog (histórico PROCESS_UPDATED).
    expect(ctx.processRepository.items[0]?.reference).toBe('REF-1 / HBL-999');
    expect(
      ctx.processRepository.history.filter((h) => h.action === 'PROCESS_UPDATED'),
    ).toHaveLength(1);

    // Terceiro ciclo sem alterações: cursor fica onde estava, nada é reescrito.
    const third = await ctx.service.runOnce();
    expect(third).toMatchObject({ examined: 0, lastChangelogAt: '2026-09-21 12:05:00' });
    expect(
      ctx.processRepository.history.filter((h) => h.action === 'PROCESS_UPDATED'),
    ).toHaveLength(1);
  });

  it('vincula o processo aberto por e-mail (mesmo identificador, empresa pendente) em vez de duplicar, e conclui o cadastro', async () => {
    const ctx = await buildContext();
    // O e-mail "Novo Processo - 230/26" chegou antes do iLog: empresa pendente pelo domínio.
    const pending = await seedCompany(ctx, { cnpj: null, legalName: 'casaenovidade.com.br' });
    const local = await ctx.processService.create(ctx.adminId, ALL, {
      clientCompanyId: pending.id,
      reference: '230/26 - DANGB26080406',
      source: 'EMAIL',
    });

    ctx.source.processes.set(
      350368,
      makeIlogProcess({
        ilogProcessId: 350368,
        number: '31435/26',
        clientRef: 'DANGB26080406',
        houseBl: 'DANGB26080406',
      }),
    );

    const result = await ctx.service.runOnce();
    expect(result).toMatchObject({
      created: 0,
      linked: 1,
      companiesCompleted: 1,
      companiesCreated: 0,
    });
    expect(ctx.processRepository.items).toHaveLength(1);
    expect(ctx.processRepository.items[0]).toMatchObject({
      id: local.id,
      reference: '230/26 - DANGB26080406',
      source: 'EMAIL',
      ilogProcessId: 350368,
      ilogNumber: '31435/26',
      clientCompanyId: pending.id,
    });
    expect(ctx.companyRepository.items[0]).toMatchObject({
      id: pending.id,
      cnpj: '12345678000195',
      documentType: 'CNPJ',
      legalName: 'CASA E NOVIDADE COMERCIO LTDA',
      ilogCompanyId: 569,
    });
    // O índice tem os dois lados: o que o e-mail trouxe (EMAIL) e o que o iLog confirma (ILOG).
    const identifiers = await ctx.processIdentifierRepository.listByProcess(local.id);
    expect(identifiers.map((i) => [i.value, i.source])).toEqual(
      expect.arrayContaining([
        ['230/26', 'EMAIL'],
        ['DANGB26080406', 'ILOG'],
        ['31435/26', 'ILOG'],
      ]),
    );
  });

  it('não vincula quando o identificador bate mas a empresa é outra (com CNPJ diferente): espelha um novo', async () => {
    const ctx = await buildContext();
    const other = await seedCompany(ctx, { cnpj: '99999999000191', legalName: 'OUTRA LTDA' });
    await ctx.processService.create(ctx.adminId, ALL, {
      clientCompanyId: other.id,
      reference: 'DANGB26080406',
      source: 'WEB',
    });

    ctx.source.processes.set(1, makeIlogProcess({ ilogProcessId: 1, houseBl: 'DANGB26080406' }));
    const result = await ctx.service.runOnce();
    expect(result).toMatchObject({ created: 1, linked: 0 });
    expect(ctx.processRepository.items).toHaveLength(2);
  });

  it('empresa já cadastrada pelo CNPJ ganha o vínculo com o iLog e os domínios de contato', async () => {
    const ctx = await buildContext();
    const existing = await seedCompany(ctx, {
      cnpj: '12345678000195',
      legalName: 'Casa e Novidade (cadastro manual)',
    });
    ctx.source.processes.set(1, makeIlogProcess({ ilogProcessId: 1 }));

    const result = await ctx.service.runOnce();
    expect(result).toMatchObject({
      created: 1,
      companiesCreated: 0,
      companiesCompleted: 0,
      domainsRegistered: 1,
    });
    expect(ctx.companyRepository.items).toHaveLength(1);
    expect(ctx.companyRepository.items[0]).toMatchObject({ id: existing.id, ilogCompanyId: 569 });
    expect(ctx.processRepository.items[0]?.clientCompanyId).toBe(existing.id);
    expect(ctx.emailDomainRepository.items[0]).toMatchObject({
      domain: 'casaenovidade.com.br',
      organizationId: existing.organizationId,
    });
  });

  it('conclui um cadastro pendente pelo nome ou pelo domínio de contato já conhecido', async () => {
    const ctx = await buildContext();
    const byName = await seedCompany(ctx, { cnpj: null, legalName: 'Casa & Novidade' });
    ctx.source.processes.set(1, makeIlogProcess({ ilogProcessId: 1 }));
    await ctx.service.runOnce();
    expect(ctx.companyRepository.items).toHaveLength(1);
    expect(ctx.companyRepository.items[0]).toMatchObject({
      id: byName.id,
      cnpj: '12345678000195',
      ilogCompanyId: 569,
    });

    const ctx2 = await buildContext();
    const org = await ctx2.organizationRepository.create({
      name: 'globoimport.com.br',
      isInternal: false,
    });
    await ctx2.emailDomainRepository.create({
      domain: 'globoimport.com.br',
      organizationId: org.id,
      defaultRole: 'CLIENT',
      autoApprove: false,
    });
    const byDomain = await seedCompany(ctx2, {
      cnpj: null,
      legalName: 'globoimport.com.br',
      organizationId: org.id,
    });
    ctx2.source.processes.set(
      2,
      makeIlogProcess({
        ilogProcessId: 2,
        importer: {
          ilogCompanyId: 344,
          legalName: 'T. GLOBO IMPORTACAO E EXPORTACAO LTDA',
          tradeName: null,
          cnpj: '15135338001361',
          contactDomains: ['globoimport.com.br'],
        },
      }),
    );
    await ctx2.service.runOnce();
    expect(ctx2.companyRepository.items).toHaveLength(1);
    expect(ctx2.companyRepository.items[0]).toMatchObject({
      id: byDomain.id,
      cnpj: '15135338001361',
      legalName: 'T. GLOBO IMPORTACAO E EXPORTACAO LTDA',
    });
    // O domínio já existia: não duplica.
    expect(ctx2.emailDomainRepository.items).toHaveLength(1);
  });

  it('empresas que compartilham um domínio de contato (grupo/filiais) entram na mesma organização', async () => {
    const ctx = await buildContext();
    const domains = ['carstation.com.br', 'phtransportes.com'];
    ctx.source.sharedDomains.push('phtransportes.com'); // transportadora: 4+ empresas sem relação
    ctx.source.processes.set(
      1,
      makeIlogProcess({
        ilogProcessId: 1,
        importer: {
          ilogCompanyId: 235,
          legalName: 'MV5 COMERCIO LTDA',
          tradeName: null,
          cnpj: '05295679000100',
          contactDomains: domains,
        },
      }),
    );
    ctx.source.processes.set(
      2,
      makeIlogProcess({
        ilogProcessId: 2,
        importer: {
          ilogCompanyId: 301,
          legalName: 'V. TECH COMERCIO E LOCACAO',
          tradeName: null,
          cnpj: '13478900000100',
          contactDomains: domains,
        },
      }),
    );

    const result = await ctx.service.runOnce();
    expect(result).toMatchObject({ created: 2, companiesCreated: 2, domainsRegistered: 1 });
    expect(ctx.organizationRepository.items).toHaveLength(1);
    expect(ctx.companyRepository.items.map((c) => c.organizationId)).toEqual([
      ctx.organizationRepository.items[0]?.id,
      ctx.organizationRepository.items[0]?.id,
    ]);
    expect(ctx.emailDomainRepository.items.map((d) => d.domain)).toEqual(['carstation.com.br']);
  });

  it('processo sem importador é ignorado com aviso', async () => {
    const ctx = await buildContext();
    ctx.source.processes.set(1, makeIlogProcess({ ilogProcessId: 1, importer: null }));
    const result = await ctx.service.runOnce();
    expect(result).toMatchObject({ examined: 1, created: 0, skipped: 1 });
    expect(ctx.warnings).toContain('iLog: processo sem importador, ignorado');
  });

  it('falha do iLog fica registrada em lastError e sobe para o job', async () => {
    const ctx = await buildContext();
    ctx.source.failWith = new Error('ECONNREFUSED');
    await expect(ctx.service.runOnce()).rejects.toThrow('ECONNREFUSED');
    const state = await ctx.syncStateRepository.get('ILOG');
    expect(state).toMatchObject({ lastError: 'ECONNREFUSED', backfillDone: false });
    expect(state?.lastRunAt).toBeInstanceOf(Date);
  });

  it('não roda dois ciclos ao mesmo tempo', async () => {
    const ctx = await buildContext();
    ctx.source.processes.set(1, makeIlogProcess({ ilogProcessId: 1 }));
    const first = ctx.service.runOnce();
    await expect(ctx.service.runOnce()).rejects.toMatchObject({
      code: 'ILOG_SYNC_BUSY',
      status: 409,
    });
    await first;
  });

  it('usa ILOG_SYNC_ACTOR_EMAIL quando é um usuário ativo; sem ADMIN ativo nem ator, falha com ILOG_SYNC_NO_ACTOR', async () => {
    const ctx = await buildContext({ actorEmail: 'robo@opusce.com.br' });
    const robot = await ctx.userRepository.create({
      name: 'Robô iLog',
      email: 'robo@opusce.com.br',
      passwordHash: null,
      role: 'OPERATIONAL',
      status: 'ACTIVE',
      accessScope: 'ORGANIZATION',
      organizationId: null,
    });
    ctx.processRepository.users.push({ id: robot.id, name: robot.name, email: robot.email });
    ctx.source.processes.set(1, makeIlogProcess({ ilogProcessId: 1 }));
    await ctx.service.runOnce();
    expect(ctx.processRepository.items[0]?.createdById).toBe(robot.id);

    const noActor = await buildContext({ admin: false });
    await expect(noActor.service.runOnce()).rejects.toBeInstanceOf(AppError);
    await expect(noActor.service.runOnce()).rejects.toMatchObject({ code: 'ILOG_SYNC_NO_ACTOR' });
  });
});

describe('IlogSyncService.importByIdentifier — retaguarda B (docs/15, seção 4)', () => {
  it('espelha na hora o processo do iLog que tem o identificador e devolve o item local', async () => {
    const ctx = await buildContext();
    ctx.source.processes.set(
      350368,
      makeIlogProcess({ ilogProcessId: 350368, number: '31435/26', houseBl: 'DANGB26080406' }),
    );

    const found = await ctx.service.importByIdentifier('31435/26');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ ilogNumber: '31435/26', source: 'ILOG' });
    expect(ctx.source.calls.findByIdentifier).toBe(1);

    // Segunda importação do mesmo: não duplica.
    const again = await ctx.service.importByIdentifier('DANGB26080406');
    expect(again.map((p) => p.id)).toEqual(found.map((p) => p.id));
    expect(ctx.processRepository.items).toHaveLength(1);
  });

  it('devolve vazio quando o iLog não tem ou falha (e registra lastError)', async () => {
    const ctx = await buildContext();
    expect(await ctx.service.importByIdentifier('NAOEXISTE1')).toEqual([]);

    ctx.source.failWith = new Error('timeout');
    expect(await ctx.service.importByIdentifier('31435/26')).toEqual([]);
    expect((await ctx.syncStateRepository.get('ILOG'))?.lastError).toBe('timeout');
    expect(ctx.warnings).toContain('iLog: consulta pontual falhou');
  });
});
