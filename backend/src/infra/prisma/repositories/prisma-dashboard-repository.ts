import type { Prisma, PrismaClient } from '@prisma/client';

import type { DashboardFilters } from '@/domain/entities/dashboard';
import type {
  DashboardProcessRow,
  DashboardRepository,
  DashboardStageChangeRow,
  DashboardStageRow,
  ProcessForStageTiming,
} from '@/domain/repositories/dashboard-repository';

export class PrismaDashboardRepository implements DashboardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listStages(): Promise<DashboardStageRow[]> {
    const stages = await this.prisma.kanbanStage.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, color: true, order: true },
    });
    return stages;
  }

  async listProcesses(
    filters: Pick<DashboardFilters, 'organizationId'>,
  ): Promise<DashboardProcessRow[]> {
    const where: Prisma.ProcessWhereInput = {
      deletedAt: null,
      ...(filters.organizationId
        ? { clientCompany: { organizationId: filters.organizationId } }
        : {}),
    };

    const rows = await this.prisma.process.findMany({
      where,
      select: {
        id: true,
        currentStageId: true,
        createdAt: true,
        completedAt: true,
        clientCompany: {
          select: {
            id: true,
            cnpj: true,
            legalName: true,
            organizationId: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      clientCompanyId: row.clientCompany.id,
      clientCompanyCnpj: row.clientCompany.cnpj,
      clientCompanyLegalName: row.clientCompany.legalName,
      organizationId: row.clientCompany.organization.id,
      organizationName: row.clientCompany.organization.name,
      currentStageId: row.currentStageId,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    }));
  }

  async listProcessesForStageTiming(): Promise<ProcessForStageTiming[]> {
    return this.prisma.process.findMany({
      where: { deletedAt: null },
      select: { id: true, createdAt: true, completedAt: true },
    });
  }

  async listStageChangeHistory(): Promise<DashboardStageChangeRow[]> {
    const rows = await this.prisma.processHistory.findMany({
      where: { action: 'STAGE_CHANGED' },
      orderBy: [{ processId: 'asc' }, { createdAt: 'asc' }],
      select: { processId: true, fromStageId: true, toStageId: true, createdAt: true },
    });

    return rows
      .filter(
        (
          row,
        ): row is {
          processId: string;
          fromStageId: string | null;
          toStageId: string;
          createdAt: Date;
        } => Boolean(row.toStageId),
      )
      .map((row) => ({
        processId: row.processId,
        fromStageId: row.fromStageId,
        toStageId: row.toStageId,
        createdAt: row.createdAt,
      }));
  }
}
