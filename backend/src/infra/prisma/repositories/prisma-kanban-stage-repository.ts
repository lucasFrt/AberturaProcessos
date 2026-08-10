import type { Prisma, PrismaClient } from '@prisma/client';

import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  CreateKanbanStageData,
  KanbanStage,
  UpdateKanbanStageData,
} from '@/domain/entities/kanban-stage';
import type {
  KanbanStageRepository,
  KanbanStageWithCount,
} from '@/domain/repositories/kanban-stage-repository';

const ORDER_BY: Prisma.KanbanStageOrderByWithRelationInput[] = [{ order: 'asc' }, { name: 'asc' }];

export class PrismaKanbanStageRepository implements KanbanStageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<KanbanStage | null> {
    return this.prisma.kanbanStage.findUnique({ where: { id } });
  }

  async findByName(name: string): Promise<KanbanStage | null> {
    return this.prisma.kanbanStage.findUnique({ where: { name } });
  }

  async list(): Promise<KanbanStage[]> {
    return this.prisma.kanbanStage.findMany({ orderBy: ORDER_BY });
  }

  async listWithCounts(scope: AccessScope): Promise<KanbanStageWithCount[]> {
    const stages = await this.list();

    // Escopo aplicado na contagem de processos (docs/06, AccessScope
    // obrigatório em leitura multi-tenant): COMPANIES filtra por
    // clientCompanyId dentro do conjunto de CNPJs acessíveis.
    const scopeWhere: Prisma.ProcessWhereInput =
      scope.kind === 'ALL' ? {} : { clientCompanyId: { in: scope.companyIds } };

    const counts = await Promise.all(
      stages.map((stage) =>
        this.prisma.process.count({
          where: { currentStageId: stage.id, deletedAt: null, ...scopeWhere },
        }),
      ),
    );

    return stages.map((stage, index) => ({ ...stage, processCount: counts[index] ?? 0 }));
  }

  async findMaxOrder(): Promise<number | null> {
    const result = await this.prisma.kanbanStage.aggregate({ _max: { order: true } });
    return result._max.order ?? null;
  }

  async create(data: CreateKanbanStageData & { order: number }): Promise<KanbanStage> {
    return this.prisma.kanbanStage.create({
      data: {
        name: data.name,
        order: data.order,
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.isFinal !== undefined ? { isFinal: data.isFinal } : {}),
      },
    });
  }

  async update(id: string, data: UpdateKanbanStageData): Promise<KanbanStage> {
    const updateData: Prisma.KanbanStageUpdateInput = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.isFinal !== undefined ? { isFinal: data.isFinal } : {}),
    };
    return this.prisma.kanbanStage.update({ where: { id }, data: updateData });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.kanbanStage.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.prisma.kanbanStage.count();
  }

  async countActiveProcesses(stageId: string): Promise<number> {
    return this.prisma.process.count({ where: { currentStageId: stageId, deletedAt: null } });
  }

  async reorder(stageIds: string[]): Promise<KanbanStage[]> {
    await this.prisma.$transaction(
      stageIds.map((id, index) =>
        this.prisma.kanbanStage.update({ where: { id }, data: { order: index } }),
      ),
    );
    return this.list();
  }
}
