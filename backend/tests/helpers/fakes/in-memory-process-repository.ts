import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  CreateProcessWithHistoryInput,
  Process,
  ProcessBoardStageResult,
  ProcessDetail,
  ProcessFilters,
  ProcessHistoryEntry,
  ProcessListItem,
  ProcessSort,
  UpdateProcessWithHistoryInput,
} from '@/domain/entities/process';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { ProcessRepository } from '@/domain/repositories/process-repository';

let idCounter = 0;
let historyIdCounter = 0;

interface FakeStage {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
}

interface FakeCompany {
  id: string;
  cnpj: string;
  legalName: string;
}

interface FakeUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Fake em memória de ProcessRepository (docs/09, `tests/unit` com fakes).
 * `stages`, `companies` e `users` são populados pelo teste para permitir
 * montar os resumos agregados (`ProcessListItem`/`ProcessDetail`) sem
 * depender do Prisma.
 */
export class InMemoryProcessRepository implements ProcessRepository {
  readonly items: Process[] = [];
  readonly history: (ProcessHistoryEntry & { processId: string })[] = [];
  readonly stages: FakeStage[] = [];
  readonly companies: FakeCompany[] = [];
  readonly users: FakeUser[] = [];
  /** Ano forçado para os testes de geração de código, se necessário. */
  yearOverride: number | undefined;
  private lastNumberByYear = new Map<number, number>();

  private scopeMatches(process: Process, scope: AccessScope): boolean {
    if (scope.kind === 'ALL') return true;
    return (
      scope.companyIds.includes(process.clientCompanyId) ||
      (process.requestingCompanyId !== null &&
        scope.companyIds.includes(process.requestingCompanyId))
    );
  }

  private companySummary(id: string): { id: string; cnpj: string; legalName: string } {
    const company = this.companies.find((item) => item.id === id);
    return company ?? { id, cnpj: '00000000000000', legalName: 'Empresa desconhecida' };
  }

  private stageSummary(id: string): FakeStage {
    const stage = this.stages.find((item) => item.id === id);
    return stage ?? { id, name: 'Etapa desconhecida', color: '#000000', order: 0, isFinal: false };
  }

  private userSummary(id: string): { id: string; name: string } {
    const user = this.users.find((item) => item.id === id);
    return user ?? { id, name: 'Usuário desconhecido' };
  }

  private toListItem(process: Process): ProcessListItem {
    return {
      id: process.id,
      code: process.code,
      reference: process.reference,
      clientCompany: this.companySummary(process.clientCompanyId),
      requestingCompany: process.requestingCompanyId
        ? this.companySummary(process.requestingCompanyId)
        : null,
      currentStage: this.stageSummary(process.currentStageId),
      responsible: process.responsibleId ? this.userSummary(process.responsibleId) : null,
      documentCount: 0,
      stageChangedAt: process.stageChangedAt,
      completedAt: process.completedAt,
      createdAt: process.createdAt,
    };
  }

  private toDetail(process: Process): ProcessDetail {
    const responsibleUser = process.responsibleId
      ? this.users.find((user) => user.id === process.responsibleId)
      : undefined;

    return {
      id: process.id,
      code: process.code,
      reference: process.reference,
      additionalInfo: process.additionalInfo,
      clientCompany: this.companySummary(process.clientCompanyId),
      requestingCompany: process.requestingCompanyId
        ? this.companySummary(process.requestingCompanyId)
        : null,
      currentStage: this.stageSummary(process.currentStageId),
      responsible: responsibleUser
        ? { id: responsibleUser.id, name: responsibleUser.name, email: responsibleUser.email }
        : null,
      createdBy: this.userSummary(process.createdById),
      stageChangedAt: process.stageChangedAt,
      completedAt: process.completedAt,
      createdAt: process.createdAt,
      updatedAt: process.updatedAt,
      documents: [],
      history: this.history
        .filter((entry) => entry.processId === process.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    };
  }

  async findRawById(id: string, scope: AccessScope): Promise<Process | null> {
    const process = this.items.find((item) => item.id === id && item.deletedAt === null);
    if (!process || !this.scopeMatches(process, scope)) return null;
    return process;
  }

  async findDetailById(id: string, scope: AccessScope): Promise<ProcessDetail | null> {
    const process = await this.findRawById(id, scope);
    return process ? this.toDetail(process) : null;
  }

  async list(
    filters: ProcessFilters,
    scope: AccessScope,
    pagination: PaginationParams,
    sort: ProcessSort,
  ): Promise<Page<ProcessListItem>> {
    let filtered = this.items.filter(
      (item) => item.deletedAt === null && this.scopeMatches(item, scope),
    );

    if (filters.stageId) filtered = filtered.filter((p) => p.currentStageId === filters.stageId);
    if (filters.clientCompanyId)
      filtered = filtered.filter((p) => p.clientCompanyId === filters.clientCompanyId);
    if (filters.responsibleId)
      filtered = filtered.filter((p) => p.responsibleId === filters.responsibleId);
    if (filters.q) {
      const q = filters.q.toLowerCase();
      filtered = filtered.filter(
        (p) => p.code.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q),
      );
    }

    filtered.sort((a, b) => {
      const av = a[sort.field] instanceof Date ? (a[sort.field] as Date).getTime() : a[sort.field];
      const bv = b[sort.field] instanceof Date ? (b[sort.field] as Date).getTime() : b[sort.field];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.order === 'asc' ? cmp : -cmp;
    });

    const start = (pagination.page - 1) * pagination.pageSize;
    const items = filtered.slice(start, start + pagination.pageSize).map((p) => this.toListItem(p));
    return { items, total: filtered.length };
  }

  async board(
    filters: ProcessFilters,
    scope: AccessScope,
    limitPerStage: number,
  ): Promise<ProcessBoardStageResult[]> {
    const sortedStages = [...this.stages].sort((a, b) => a.order - b.order);
    return sortedStages.map((stage) => {
      const filtered = this.items.filter(
        (item) =>
          item.deletedAt === null &&
          item.currentStageId === stage.id &&
          this.scopeMatches(item, scope) &&
          (!filters.clientCompanyId || item.clientCompanyId === filters.clientCompanyId),
      );
      return {
        stage,
        total: filtered.length,
        processes: filtered.slice(0, limitPerStage).map((p) => this.toListItem(p)),
      };
    });
  }

  async createWithHistory(input: CreateProcessWithHistoryInput): Promise<ProcessDetail> {
    idCounter += 1;
    const now = new Date();
    const year = this.yearOverride ?? now.getFullYear();
    const lastNumber = (this.lastNumberByYear.get(year) ?? 0) + 1;
    this.lastNumberByYear.set(year, lastNumber);
    const code = `PRC-${year}-${String(lastNumber).padStart(5, '0')}`;

    const process: Process = {
      id: `process-${idCounter}`,
      code,
      reference: input.reference,
      additionalInfo: input.additionalInfo,
      clientCompanyId: input.clientCompanyId,
      requestingCompanyId: input.requestingCompanyId,
      currentStageId: input.currentStageId,
      responsibleId: null,
      createdById: input.createdById,
      stageChangedAt: now,
      completedAt: null,
      deletedAt: null,
      deletedById: null,
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(process);

    historyIdCounter += 1;
    this.history.push({
      id: `history-${historyIdCounter}`,
      processId: process.id,
      action: 'PROCESS_CREATED',
      fromStage: null,
      toStage: this.stageSummary(input.currentStageId),
      actor: this.userSummary(input.createdById),
      description: `Processo ${code} criado.`,
      metadata: null,
      createdAt: now,
    });

    return this.toDetail(process);
  }

  async updateWithHistory(
    id: string,
    input: UpdateProcessWithHistoryInput,
  ): Promise<ProcessDetail> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`Process ${id} não encontrado no fake.`);
    const current = this.items[index];
    if (!current) throw new Error(`Process ${id} não encontrado no fake.`);

    const updated: Process = {
      ...current,
      ...(input.data.reference !== undefined ? { reference: input.data.reference } : {}),
      ...(input.data.additionalInfo !== undefined
        ? { additionalInfo: input.data.additionalInfo }
        : {}),
      ...(input.data.clientCompanyId !== undefined
        ? { clientCompanyId: input.data.clientCompanyId }
        : {}),
      ...(input.data.requestingCompanyId !== undefined
        ? { requestingCompanyId: input.data.requestingCompanyId }
        : {}),
      updatedAt: new Date(),
    };
    this.items[index] = updated;

    historyIdCounter += 1;
    this.history.push({
      id: `history-${historyIdCounter}`,
      processId: id,
      action: 'PROCESS_UPDATED',
      fromStage: null,
      toStage: null,
      actor: this.userSummary(input.actorId),
      description: input.description,
      metadata: JSON.stringify({ diff: input.diff }),
      createdAt: new Date(),
    });

    return this.toDetail(updated);
  }
}
