import type { Prisma, PrismaClient } from '@prisma/client';

import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  CompanySummary,
  CreateProcessWithHistoryInput,
  Process,
  ProcessBoardStageResult,
  ProcessDetail,
  ProcessDocumentSummary,
  ProcessFilters,
  ProcessHistoryEntry,
  ProcessListItem,
  ProcessSort,
  StageSummary,
  UpdateProcessWithHistoryInput,
  UserSummary,
} from '@/domain/entities/process';
import type { HistoryAction } from '@/domain/enums';
import { AppError } from '@/domain/errors/app-error';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { ProcessRepository } from '@/domain/repositories/process-repository';

/** Retries em caso de colisão do `code` único gerado pela sequência (docs/04). */
const MAX_CODE_COLLISION_RETRIES = 3;

const LIST_ITEM_INCLUDE = {
  clientCompany: { select: { id: true, cnpj: true, legalName: true } },
  requestingCompany: { select: { id: true, cnpj: true, legalName: true } },
  currentStage: { select: { id: true, name: true, color: true, order: true, isFinal: true } },
  responsible: { select: { id: true, name: true } },
  _count: { select: { documents: { where: { deletedAt: null } } } },
} satisfies Prisma.ProcessInclude;

type ListItemRow = Prisma.ProcessGetPayload<{ include: typeof LIST_ITEM_INCLUDE }>;

const DETAIL_INCLUDE = {
  clientCompany: { select: { id: true, cnpj: true, legalName: true } },
  requestingCompany: { select: { id: true, cnpj: true, legalName: true } },
  currentStage: { select: { id: true, name: true, color: true, order: true, isFinal: true } },
  responsible: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true } },
  documents: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: { uploadedBy: { select: { id: true, name: true } } },
  },
  history: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      actor: { select: { id: true, name: true } },
      fromStage: { select: { id: true, name: true } },
      toStage: { select: { id: true, name: true } },
    },
  },
} as const;

type DetailRow = Prisma.ProcessGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function companySummary(company: { id: string; cnpj: string; legalName: string }): CompanySummary {
  return { id: company.id, cnpj: company.cnpj, legalName: company.legalName };
}

function stageSummary(stage: {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
}): StageSummary {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    order: stage.order,
    isFinal: stage.isFinal,
  };
}

function userSummary(user: { id: string; name: string }): UserSummary {
  return { id: user.id, name: user.name };
}

function mapListItem(row: ListItemRow): ProcessListItem {
  return {
    id: row.id,
    code: row.code,
    reference: row.reference,
    clientCompany: companySummary(row.clientCompany),
    requestingCompany: row.requestingCompany ? companySummary(row.requestingCompany) : null,
    currentStage: stageSummary(row.currentStage),
    responsible: row.responsible ? userSummary(row.responsible) : null,
    documentCount: row._count.documents,
    stageChangedAt: row.stageChangedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

function mapDocument(doc: DetailRow['documents'][number]): ProcessDocumentSummary {
  return {
    id: doc.id,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    uploadedBy: userSummary(doc.uploadedBy),
    createdAt: doc.createdAt,
  };
}

function mapHistoryEntry(entry: DetailRow['history'][number]): ProcessHistoryEntry {
  return {
    id: entry.id,
    action: entry.action as HistoryAction,
    fromStage: entry.fromStage ? { id: entry.fromStage.id, name: entry.fromStage.name } : null,
    toStage: entry.toStage ? { id: entry.toStage.id, name: entry.toStage.name } : null,
    actor: userSummary(entry.actor),
    description: entry.description,
    metadata: entry.metadata,
    createdAt: entry.createdAt,
  };
}

function mapDetail(row: DetailRow): ProcessDetail {
  return {
    id: row.id,
    code: row.code,
    reference: row.reference,
    additionalInfo: row.additionalInfo,
    clientCompany: companySummary(row.clientCompany),
    requestingCompany: row.requestingCompany ? companySummary(row.requestingCompany) : null,
    currentStage: stageSummary(row.currentStage),
    responsible: row.responsible
      ? { id: row.responsible.id, name: row.responsible.name, email: row.responsible.email }
      : null,
    createdBy: userSummary(row.createdBy),
    stageChangedAt: row.stageChangedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    documents: row.documents.map(mapDocument),
    history: row.history.map(mapHistoryEntry),
  };
}

/** Escopo por recurso (docs/06): CLIENT vê processos em que a empresa é cliente ou solicitante. */
function scopeWhere(scope: AccessScope): Prisma.ProcessWhereInput {
  if (scope.kind === 'ALL') return {};
  return {
    OR: [
      { clientCompanyId: { in: scope.companyIds } },
      { requestingCompanyId: { in: scope.companyIds } },
    ],
  };
}

function filtersWhere(filters: ProcessFilters): Prisma.ProcessWhereInput {
  return {
    ...(filters.stageId ? { currentStageId: filters.stageId } : {}),
    ...(filters.clientCompanyId ? { clientCompanyId: filters.clientCompanyId } : {}),
    ...(filters.responsibleId ? { responsibleId: filters.responsibleId } : {}),
    ...(filters.organizationId
      ? { clientCompany: { organizationId: filters.organizationId } }
      : {}),
    ...(filters.q
      ? { OR: [{ code: { contains: filters.q } }, { reference: { contains: filters.q } }] }
      : {}),
    ...(filters.createdFrom || filters.createdTo
      ? {
          createdAt: {
            ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
            ...(filters.createdTo ? { lte: filters.createdTo } : {}),
          },
        }
      : {}),
  };
}

export class PrismaProcessRepository implements ProcessRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findRawById(id: string, scope: AccessScope): Promise<Process | null> {
    return this.prisma.process.findFirst({
      where: { id, deletedAt: null, ...scopeWhere(scope) },
    });
  }

  async findDetailById(id: string, scope: AccessScope): Promise<ProcessDetail | null> {
    const row = await this.prisma.process.findFirst({
      where: { id, deletedAt: null, ...scopeWhere(scope) },
      include: DETAIL_INCLUDE,
    });
    return row ? mapDetail(row) : null;
  }

  async list(
    filters: ProcessFilters,
    scope: AccessScope,
    pagination: PaginationParams,
    sort: ProcessSort,
  ): Promise<Page<ProcessListItem>> {
    const where: Prisma.ProcessWhereInput = {
      deletedAt: null,
      ...scopeWhere(scope),
      ...filtersWhere(filters),
    };

    const [rows, total] = await Promise.all([
      this.prisma.process.findMany({
        where,
        include: LIST_ITEM_INCLUDE,
        orderBy: [{ [sort.field]: sort.order }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.process.count({ where }),
    ]);

    return { items: rows.map(mapListItem), total };
  }

  async board(
    filters: ProcessFilters,
    scope: AccessScope,
    limitPerStage: number,
  ): Promise<ProcessBoardStageResult[]> {
    const stages = await this.prisma.kanbanStage.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });

    const baseWhere: Prisma.ProcessWhereInput = {
      deletedAt: null,
      ...scopeWhere(scope),
      ...filtersWhere(filters),
    };

    const results = await Promise.all(
      stages.map(async (stage) => {
        const where: Prisma.ProcessWhereInput = { ...baseWhere, currentStageId: stage.id };
        const [total, rows] = await Promise.all([
          this.prisma.process.count({ where }),
          this.prisma.process.findMany({
            where,
            include: LIST_ITEM_INCLUDE,
            orderBy: [{ stageChangedAt: 'desc' }],
            take: limitPerStage,
          }),
        ]);

        return {
          stage: stageSummary(stage),
          total,
          processes: rows.map(mapListItem),
        };
      }),
    );

    return results;
  }

  async createWithHistory(input: CreateProcessWithHistoryInput): Promise<ProcessDetail> {
    for (let attempt = 0; attempt < MAX_CODE_COLLISION_RETRIES; attempt += 1) {
      try {
        const processId = await this.prisma.$transaction(async (tx) => {
          const year = new Date().getFullYear();

          // MERGE + OUTPUT resolve o incremento em uma única ida ao banco,
          // sob a transação, evitando código duplicado em criações
          // concorrentes (docs/04, "Geração do código do processo").
          const [seq] = await tx.$queryRaw<{ lastNumber: number }[]>`
            MERGE [process_sequences] AS target
            USING (SELECT ${year} AS [year]) AS src ON target.[year] = src.[year]
            WHEN MATCHED THEN UPDATE SET target.[lastNumber] = target.[lastNumber] + 1
            WHEN NOT MATCHED THEN INSERT ([year], [lastNumber]) VALUES (src.[year], 1)
            OUTPUT inserted.[lastNumber] AS [lastNumber];
          `;
          if (!seq) {
            throw new AppError('INTERNAL_ERROR', 'Falha ao gerar o código do processo.', 500);
          }

          const code = `PRC-${year}-${String(seq.lastNumber).padStart(5, '0')}`;

          const process = await tx.process.create({
            data: {
              code,
              reference: input.reference,
              additionalInfo: input.additionalInfo,
              clientCompanyId: input.clientCompanyId,
              requestingCompanyId: input.requestingCompanyId,
              currentStageId: input.currentStageId,
              createdById: input.createdById,
            },
          });

          await tx.processHistory.create({
            data: {
              processId: process.id,
              action: 'PROCESS_CREATED',
              toStageId: input.currentStageId,
              actorId: input.createdById,
              description: `Processo ${code} criado.`,
            },
          });

          return process.id;
        });

        const detail = await this.findDetailById(processId, { kind: 'ALL' });
        if (!detail) {
          throw new AppError('INTERNAL_ERROR', 'Falha ao carregar o processo recém-criado.', 500);
        }
        return detail;
      } catch (error) {
        const isUniqueViolation =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002';

        if (isUniqueViolation && attempt < MAX_CODE_COLLISION_RETRIES - 1) {
          continue;
        }
        throw error;
      }
    }

    throw new AppError(
      'INTERNAL_ERROR',
      'Não foi possível gerar um código de processo único após múltiplas tentativas.',
      500,
    );
  }

  async updateWithHistory(
    id: string,
    input: UpdateProcessWithHistoryInput,
  ): Promise<ProcessDetail> {
    const { data } = input;

    await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.ProcessUpdateInput = {
        ...(data.reference !== undefined ? { reference: data.reference } : {}),
        ...(data.additionalInfo !== undefined ? { additionalInfo: data.additionalInfo } : {}),
        ...(data.clientCompanyId !== undefined
          ? { clientCompany: { connect: { id: data.clientCompanyId } } }
          : {}),
        ...(data.requestingCompanyId !== undefined
          ? data.requestingCompanyId === null
            ? { requestingCompany: { disconnect: true } }
            : { requestingCompany: { connect: { id: data.requestingCompanyId } } }
          : {}),
      };

      await tx.process.update({ where: { id }, data: updateData });

      await tx.processHistory.create({
        data: {
          processId: id,
          action: 'PROCESS_UPDATED',
          actorId: input.actorId,
          description: input.description,
          metadata: JSON.stringify({ diff: input.diff }),
        },
      });
    });

    const detail = await this.findDetailById(id, { kind: 'ALL' });
    if (!detail) {
      throw new AppError('INTERNAL_ERROR', 'Falha ao carregar o processo atualizado.', 500);
    }
    return detail;
  }
}
