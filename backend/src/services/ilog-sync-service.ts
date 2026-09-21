import type { AccessScope } from '@/domain/entities/access-scope';
import type { Company } from '@/domain/entities/company';
import type { Process, ProcessListItem } from '@/domain/entities/process';
import type { ProcessIdentifierInput } from '@/domain/entities/process-identifier';
import { normalizeIdentifier } from '@/domain/entities/process-identifier';
import { AppError } from '@/domain/errors/app-error';
import type {
  IlogCompany,
  IlogProcess,
  IlogProcessSource,
} from '@/domain/ilog/ilog-process-source';
import type { CompanyRepository } from '@/domain/repositories/company-repository';
import type { EmailDomainRepository } from '@/domain/repositories/email-domain-repository';
import type { IlogSyncStateRepository } from '@/domain/repositories/ilog-sync-state-repository';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';
import type { ProcessIdentifierRepository } from '@/domain/repositories/process-identifier-repository';
import type { ProcessRepository } from '@/domain/repositories/process-repository';
import type { UserRepository } from '@/domain/repositories/user-repository';
import type { ProcessService } from '@/services/process-service';
import { isPublicWebmailDomain } from '@/shared/email-domains';

/** Só o que o service precisa de um logger; o container passa o pino. */
export interface SyncLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface IlogSyncOptions {
  /** Janela do backfill inicial: processos em aberto abertos há até N dias (docs/15, seção 5.2). */
  backfillDays: number;
  /** Máximo de processos alterados lidos por ciclo do incremental. */
  changelogLimit: number;
  /** Usuário que assina as escritas do espelho; `null` = primeiro ADMIN ativo. */
  actorEmail: string | null;
}

export interface IlogSyncServiceDeps {
  source: IlogProcessSource;
  syncStateRepository: IlogSyncStateRepository;
  processRepository: ProcessRepository;
  processIdentifierRepository: ProcessIdentifierRepository;
  companyRepository: CompanyRepository;
  organizationRepository: OrganizationRepository;
  emailDomainRepository: EmailDomainRepository;
  userRepository: UserRepository;
  processService: ProcessService;
  logger: SyncLogger;
  options: IlogSyncOptions;
}

export interface IlogSyncRunResult {
  /** `true` quando esta chamada fez o backfill inicial. */
  backfilled: boolean;
  /** Processos do iLog examinados neste ciclo. */
  examined: number;
  created: number;
  updated: number;
  /** Processos locais criados por e-mail que foram vinculados ao do iLog. */
  linked: number;
  /** Processos encerrados/cancelados no iLog e ainda inexistentes aqui: não entram no funil. */
  skipped: number;
  companiesCreated: number;
  companiesCompleted: number;
  domainsRegistered: number;
  /** Ponto do `changelog` gravado ao final. */
  lastChangelogAt: string | null;
}

/** Contadores e caches de uma execução (um ciclo ou uma importação pontual). */
interface RunContext {
  actorId: string;
  syncedAt: Date;
  result: IlogSyncRunResult;
  companyByIlogId: Map<number, Company>;
  sharedDomains: Set<string> | null;
}

/** Espelho e importação pontual são internos: escopo sempre ALL. */
const ALL: AccessScope = { kind: 'ALL' };

/** Lote de processos lidos do iLog por ida (`IN (...)`), alinhado ao provider. */
const MIRROR_BATCH_SIZE = 200;

function emptyResult(): IlogSyncRunResult {
  return {
    backfilled: false,
    examined: 0,
    created: 0,
    updated: 0,
    linked: 0,
    skipped: 0,
    companiesCreated: 0,
    companiesCompleted: 0,
    domainsRegistered: 0,
    lastChangelogAt: null,
  };
}

/** Comparação de nomes de empresa: maiúsculas, sem acento, sem pontuação nem sufixos societários. */
function normalizeCompanyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(
      /\b(LTDA|LTD|SA|S\/A|ME|EPP|EIRELI|CIA|COMERCIO|COMERCIAL|IMPORTACAO|EXPORTACAO|E)\b/g,
      ' ',
    )
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Identificadores que o iLog conhece para um processo (docs/15, seção 5.1). */
export function identifiersOf(process: IlogProcess): ProcessIdentifierInput[] {
  const out: ProcessIdentifierInput[] = [{ kind: 'OPUS_NUMBER', value: process.number }];
  if (process.clientRef) out.push({ kind: 'CLIENT_REF', value: process.clientRef });
  if (process.houseBl) out.push({ kind: 'HBL', value: process.houseBl });
  if (process.masterBl) out.push({ kind: 'MBL', value: process.masterBl });
  if (process.di) out.push({ kind: 'DI', value: process.di });
  if (process.ce) out.push({ kind: 'CE', value: process.ce });
  if (process.dta) out.push({ kind: 'DTA', value: process.dta });
  for (const container of process.containers) out.push({ kind: 'CONTAINER', value: container });
  for (const invoice of process.invoices) out.push({ kind: 'INVOICE', value: invoice });
  return out;
}

/** Texto de exibição do processo espelhado: referência do cliente e HBL (quando diferentes), ou o número. */
export function referenceOf(process: IlogProcess): string {
  const parts: string[] = [];
  if (process.clientRef) parts.push(process.clientRef);
  if (
    process.houseBl &&
    normalizeIdentifier(process.houseBl) !== normalizeIdentifier(process.clientRef ?? '')
  ) {
    parts.push(process.houseBl);
  }
  return parts.length > 0 ? parts.join(' / ') : process.number;
}

/**
 * Espelho incremental do iLog (docs/15, seções 5.1–5.3; Tarefa 30): lê os
 * processos abertos/alterados no iLog e os reflete aqui — cria o que não
 * existe, atualiza identificadores e empresa do que existe e **vincula** o
 * processo que o e-mail do cliente já tinha aberto, em vez de duplicar. É
 * também a retaguarda pontual do intake (`importByIdentifier`): quando o
 * índice local não tem um identificador, consulta o iLog uma vez.
 *
 * Nunca escreve no iLog. As escritas locais passam pelo `ProcessService`
 * (código sequencial, histórico, tempo real) como qualquer outra origem.
 */
export class IlogSyncService {
  private running = false;

  constructor(private readonly deps: IlogSyncServiceDeps) {}

  /** Um ciclo: backfill (só na primeira vez) + incremental pelo `changelog`. */
  async runOnce(): Promise<IlogSyncRunResult> {
    if (this.running) {
      throw new AppError('ILOG_SYNC_BUSY', 'O espelho do iLog já está em execução.', 409);
    }
    this.running = true;
    try {
      const ctx = await this.newContext();
      const state = await this.deps.syncStateRepository.get('ILOG');
      // O cursor nasce ANTES do backfill: o que mudar durante a carga entra no
      // primeiro incremental (sobreposição, não perda).
      const startedAt = await this.deps.source.now();
      let cursor = state?.lastChangelogAt ?? startedAt;

      if (!state?.backfillDone) {
        const since = new Date(Date.now() - this.deps.options.backfillDays * 24 * 60 * 60 * 1000);
        const ids = await this.deps.source.listOpenProcessIds(since);
        this.deps.logger.info({ count: ids.length, since }, 'iLog: backfill inicial');
        await this.mirrorIds(ids, ctx);
        ctx.result.backfilled = true;
        await this.deps.syncStateRepository.update('ILOG', {
          backfillDone: true,
          lastChangelogAt: cursor,
        });
      }

      const changed = await this.deps.source.listChangedProcessIds(
        cursor,
        this.deps.options.changelogLimit,
      );
      await this.mirrorIds(changed.ilogProcessIds, ctx);
      if (changed.latestChangedAt && changed.latestChangedAt > cursor) {
        cursor = changed.latestChangedAt;
      }

      ctx.result.lastChangelogAt = cursor;
      await this.deps.syncStateRepository.update('ILOG', {
        lastChangelogAt: cursor,
        lastRunAt: new Date(),
        lastError: null,
      });
      this.deps.logger.info({ ...ctx.result }, 'iLog: ciclo concluído');
      return ctx.result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido.';
      await this.deps.syncStateRepository.update('ILOG', {
        lastRunAt: new Date(),
        lastError: message,
      });
      throw error;
    } finally {
      this.running = false;
    }
  }

  /**
   * Retaguarda B (docs/15, seção 4): o índice local não tem o identificador
   * → pergunta ao iLog uma vez e espelha o que achar. Devolve os processos
   * locais correspondentes (criados ou já existentes). Falha do iLog não
   * derruba o intake: registra em `lastError` e devolve vazio.
   */
  async importByIdentifier(value: string, limit = 5): Promise<ProcessListItem[]> {
    try {
      const ids = await this.deps.source.findProcessIdsByIdentifier(value, limit);
      if (ids.length === 0) return [];
      const ctx = await this.newContext();
      const processIds = await this.mirrorIds(ids, ctx);
      return this.deps.processRepository.findListItemsByIds(processIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido.';
      this.deps.logger.warn({ value, error: message }, 'iLog: consulta pontual falhou');
      await this.deps.syncStateRepository.update('ILOG', { lastError: message });
      return [];
    }
  }

  private async newContext(): Promise<RunContext> {
    return {
      actorId: await this.resolveActorId(),
      syncedAt: new Date(),
      result: emptyResult(),
      companyByIlogId: new Map(),
      sharedDomains: null,
    };
  }

  /** Espelha os processos e devolve os ids locais correspondentes (na ordem do iLog). */
  private async mirrorIds(ilogProcessIds: number[], ctx: RunContext): Promise<string[]> {
    const localIds: string[] = [];
    for (let index = 0; index < ilogProcessIds.length; index += MIRROR_BATCH_SIZE) {
      const batch = ilogProcessIds.slice(index, index + MIRROR_BATCH_SIZE);
      const processes = await this.deps.source.fetchProcesses(batch);
      for (const process of processes) {
        ctx.result.examined += 1;
        const localId = await this.mirrorOne(process, ctx);
        if (localId) localIds.push(localId);
      }
    }
    return localIds;
  }

  private async mirrorOne(process: IlogProcess, ctx: RunContext): Promise<string | null> {
    const identifiers = identifiersOf(process);
    const link = {
      ilogProcessId: process.ilogProcessId,
      ilogNumber: process.number,
      syncedAt: ctx.syncedAt,
    };

    const existing = await this.deps.processRepository.findByIlogProcessId(process.ilogProcessId);
    if (existing) {
      await this.refresh(existing, process, identifiers, ctx);
      await this.deps.processRepository.linkIlog(existing.id, link);
      ctx.result.updated += 1;
      return existing.id;
    }

    if (!process.importer) {
      this.deps.logger.warn(
        { ilogProcessId: process.ilogProcessId, number: process.number },
        'iLog: processo sem importador, ignorado',
      );
      ctx.result.skipped += 1;
      return null;
    }

    // Processo aberto por e-mail antes de existir no iLog (docs/15, seção
    // 5.2 item 5): mesmo identificador → vincula, em vez de duplicar.
    const local = await this.findLinkableLocalProcess(identifiers, process.importer);
    if (local) {
      const company = await this.resolveCompany(process.importer, ctx, local.clientCompanyId);
      if (company.id !== local.clientCompanyId) {
        await this.deps.processService.update(local.id, ctx.actorId, ALL, {
          clientCompanyId: company.id,
        });
      }
      await this.deps.processIdentifierRepository.replaceForProcess(local.id, 'ILOG', identifiers);
      await this.deps.processRepository.linkIlog(local.id, link);
      ctx.result.linked += 1;
      this.deps.logger.info(
        { processId: local.id, code: local.code, ilogNumber: process.number },
        'iLog: processo criado por e-mail vinculado',
      );
      return local.id;
    }

    // Encerrado/cancelado e ainda não existe aqui: não entra no funil.
    if (process.closedAt || process.cancelledAt) {
      ctx.result.skipped += 1;
      return null;
    }

    const company = await this.resolveCompany(process.importer, ctx, null);
    const created = await this.deps.processService.create(ctx.actorId, ALL, {
      clientCompanyId: company.id,
      reference: referenceOf(process),
      source: 'ILOG',
      receivedAt: process.openedAt,
      ilog: link,
      identifiers,
    });
    ctx.result.created += 1;
    return created.id;
  }

  /** Processo já espelhado: só o que mudou no iLog (referência, empresa, identificadores). */
  private async refresh(
    existing: Process,
    process: IlogProcess,
    identifiers: ProcessIdentifierInput[],
    ctx: RunContext,
  ): Promise<void> {
    const updates: { reference?: string; clientCompanyId?: string } = {};

    // A referência de um processo aberto por e-mail é do agente/da pessoa;
    // só a dos espelhados acompanha o iLog.
    if (existing.source === 'ILOG') {
      const reference = referenceOf(process);
      if (reference !== existing.reference) updates.reference = reference;
    }

    if (process.importer) {
      const company = await this.resolveCompany(process.importer, ctx, existing.clientCompanyId);
      if (company.id !== existing.clientCompanyId) updates.clientCompanyId = company.id;
    }

    if (Object.keys(updates).length > 0) {
      await this.deps.processService.update(existing.id, ctx.actorId, ALL, {
        ...updates,
        identifierSource: 'ILOG',
      });
    }
    await this.deps.processIdentifierRepository.replaceForProcess(existing.id, 'ILOG', identifiers);
  }

  /**
   * Processo local sem vínculo cujo índice já tem um destes identificadores.
   * Só vincula quando a empresa bate: a mesma (`ilogCompanyId`/CNPJ) ou um
   * cadastro pendente (o e-mail veio sem CNPJ) — identificador igual em
   * empresa diferente é colisão, não o mesmo embarque.
   */
  private async findLinkableLocalProcess(
    identifiers: ProcessIdentifierInput[],
    importer: IlogCompany,
  ): Promise<Process | null> {
    const normalized = identifiers.map((item) => normalizeIdentifier(item.value));
    const matches = await this.deps.processIdentifierRepository.findByNormalized(normalized);
    const processIds = [...new Set(matches.map((match) => match.processId))];
    for (const processId of processIds) {
      const candidate = await this.deps.processRepository.findRawById(processId, ALL);
      if (!candidate || candidate.ilogProcessId !== null) continue;
      const company = await this.deps.companyRepository.findById(candidate.clientCompanyId);
      if (!company) continue;
      const sameCompany =
        (company.ilogCompanyId !== null && company.ilogCompanyId === importer.ilogCompanyId) ||
        (company.cnpj !== null && importer.cnpj !== null && company.cnpj === importer.cnpj);
      if (sameCompany || company.cnpj === null) return candidate;
    }
    return null;
  }

  // ── Empresas (docs/15, seção 5.2 item 4; Tarefa 30b) ──────────────

  /**
   * Empresa local para o importador do iLog: por `ilogCompanyId`, depois por
   * CNPJ; senão conclui um cadastro pendente que combine (o do processo em
   * mãos, mesmo nome ou domínio de contato); senão cria a empresa com os
   * dados reais do iLog — na organização que já tem um dos seus domínios de
   * contato (grupo/filiais), ou numa organização nova — e registra os
   * domínios de contato que identificam o cliente.
   */
  private async resolveCompany(
    importer: IlogCompany,
    ctx: RunContext,
    preferredCompanyId: string | null,
  ): Promise<Company> {
    const cached = ctx.companyByIlogId.get(importer.ilogCompanyId);
    if (cached) return cached;

    const resolved = await this.resolveCompanyUncached(importer, ctx, preferredCompanyId);
    ctx.companyByIlogId.set(importer.ilogCompanyId, resolved);
    return resolved;
  }

  private async resolveCompanyUncached(
    importer: IlogCompany,
    ctx: RunContext,
    preferredCompanyId: string | null,
  ): Promise<Company> {
    const byIlogId = await this.deps.companyRepository.findByIlogCompanyId(importer.ilogCompanyId);
    if (byIlogId) return byIlogId;

    if (importer.cnpj) {
      const byCnpj = await this.deps.companyRepository.findByCnpj(importer.cnpj);
      if (byCnpj) {
        const linked = await this.deps.companyRepository.update(byCnpj.id, {
          ilogCompanyId: importer.ilogCompanyId,
        });
        await this.registerContactDomains(importer, linked.organizationId, ctx);
        return linked;
      }
    }

    const pending = await this.findPendingCompany(importer, preferredCompanyId, ctx);
    if (pending) {
      const completed = await this.deps.companyRepository.update(pending.id, {
        ...(importer.cnpj ? { cnpj: importer.cnpj, documentType: 'CNPJ' } : {}),
        legalName: importer.legalName,
        tradeName: importer.tradeName,
        ilogCompanyId: importer.ilogCompanyId,
      });
      ctx.result.companiesCompleted += 1;
      this.deps.logger.info(
        { companyId: completed.id, legalName: completed.legalName, cnpj: completed.cnpj },
        'iLog: cadastro pendente concluído',
      );
      await this.registerContactDomains(importer, completed.organizationId, ctx);
      return completed;
    }

    // Domínio de contato já registrado (por outra empresa do grupo, pelo
    // intake ou à mão) → a organização é a mesma: é o que "organização"
    // significa aqui — o domínio agrupa os CNPJs (docs/01).
    const organizationId =
      (await this.findOrganizationByContactDomain(importer, ctx)) ??
      (
        await this.deps.organizationRepository.create({
          name: importer.tradeName ?? importer.legalName,
          isInternal: false,
        })
      ).id;
    const company = await this.deps.companyRepository.create({
      cnpj: importer.cnpj,
      documentType: importer.cnpj ? 'CNPJ' : null,
      legalName: importer.legalName,
      tradeName: importer.tradeName,
      organizationId,
      ilogCompanyId: importer.ilogCompanyId,
    });
    ctx.result.companiesCreated += 1;
    this.deps.logger.info(
      { companyId: company.id, legalName: company.legalName, cnpj: company.cnpj },
      'iLog: empresa cadastrada',
    );
    await this.registerContactDomains(importer, organizationId, ctx);
    return company;
  }

  /** Organização (não interna) que já tem um dos domínios de contato identificadores do importador. */
  private async findOrganizationByContactDomain(
    importer: IlogCompany,
    ctx: RunContext,
  ): Promise<string | null> {
    for (const domain of await this.identifyingDomains(importer, ctx)) {
      const known = await this.deps.emailDomainRepository.findByDomain(domain);
      if (!known) continue;
      const organization = await this.deps.organizationRepository.findById(known.organizationId);
      if (organization && !organization.isInternal) return organization.id;
    }
    return null;
  }

  /**
   * Domínios de contato que identificam o cliente: corporativos (não webmail)
   * e não usados por empresas sem relação entre si no iLog (transportadoras,
   * despachantes — `listSharedContactDomains`, lido uma vez por execução).
   */
  private async identifyingDomains(importer: IlogCompany, ctx: RunContext): Promise<string[]> {
    if (importer.contactDomains.length === 0) return [];
    if (ctx.sharedDomains === null) {
      ctx.sharedDomains = new Set(await this.deps.source.listSharedContactDomains());
    }
    const shared = ctx.sharedDomains;
    return importer.contactDomains.filter(
      (domain) => !isPublicWebmailDomain(domain) && !shared.has(domain),
    );
  }

  /**
   * Cadastro pendente (sem CNPJ) que corresponde ao importador: o da empresa
   * do processo em mãos, um com o mesmo nome, ou um cuja organização tem um
   * domínio de contato do importador no iLog.
   */
  private async findPendingCompany(
    importer: IlogCompany,
    preferredCompanyId: string | null,
    ctx: RunContext,
  ): Promise<Company | null> {
    if (preferredCompanyId) {
      const preferred = await this.deps.companyRepository.findById(preferredCompanyId);
      if (preferred && preferred.cnpj === null && preferred.ilogCompanyId === null)
        return preferred;
    }

    const page = await this.deps.companyRepository.list(
      { pendingRegistration: true, isActive: true },
      { page: 1, pageSize: 200 },
    );
    const names = new Set(
      [importer.legalName, importer.tradeName]
        .filter((name): name is string => name !== null)
        .map(normalizeCompanyName)
        .filter((name) => name.length > 0),
    );
    for (const candidate of page.items) {
      if (candidate.ilogCompanyId !== null) continue;
      const candidateNames = [candidate.legalName, candidate.tradeName]
        .filter((name): name is string => name !== null)
        .map(normalizeCompanyName);
      if (candidateNames.some((name) => name.length > 0 && names.has(name))) return candidate;
    }

    for (const domain of await this.identifyingDomains(importer, ctx)) {
      const known = await this.deps.emailDomainRepository.findByDomain(domain);
      if (!known) continue;
      const pendingOfOrg = page.items.find(
        (candidate) =>
          candidate.organizationId === known.organizationId && candidate.ilogCompanyId === null,
      );
      if (pendingOfOrg) return pendingOfOrg;
    }

    return null;
  }

  /**
   * Domínios de contato identificadores do importador viram `EmailDomain` da
   * organização (docs/15, seção 5.1), quando ainda desconhecidos aqui.
   * `autoApprove = false`: agrupa sem conceder acesso a ninguém (mesma regra
   * do intake, docs/13).
   */
  private async registerContactDomains(
    importer: IlogCompany,
    organizationId: string,
    ctx: RunContext,
  ): Promise<void> {
    for (const domain of await this.identifyingDomains(importer, ctx)) {
      const known = await this.deps.emailDomainRepository.findByDomain(domain);
      if (known) continue;
      await this.deps.emailDomainRepository.create({
        domain,
        organizationId,
        defaultRole: 'CLIENT',
        autoApprove: false,
      });
      ctx.result.domainsRegistered += 1;
    }
  }

  // ── Ator das escritas ──────────────────────────────────────────────

  private async resolveActorId(): Promise<string> {
    const { actorEmail } = this.deps.options;
    if (actorEmail) {
      const user = await this.deps.userRepository.findByEmail(actorEmail);
      if (user && user.status === 'ACTIVE') return user.id;
      this.deps.logger.warn(
        { actorEmail },
        'iLog: ILOG_SYNC_ACTOR_EMAIL não é um usuário ativo; usando o primeiro ADMIN',
      );
    }
    const admins = await this.deps.userRepository.listActiveByRoles(['ADMIN']);
    const admin = admins[0];
    if (!admin) {
      throw new AppError(
        'ILOG_SYNC_NO_ACTOR',
        'Nenhum usuário ativo para assinar as escritas do espelho do iLog (ILOG_SYNC_ACTOR_EMAIL ou um ADMIN ativo).',
        500,
      );
    }
    return admin.id;
  }
}
