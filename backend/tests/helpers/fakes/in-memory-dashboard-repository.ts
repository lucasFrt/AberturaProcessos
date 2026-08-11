import type { DashboardFilters } from '@/domain/entities/dashboard';
import type {
  DashboardProcessRow,
  DashboardRepository,
  DashboardStageChangeRow,
  DashboardStageRow,
  ProcessForStageTiming,
} from '@/domain/repositories/dashboard-repository';

/** Fake em memória (docs/09) — nunca sobe banco. */
export class InMemoryDashboardRepository implements DashboardRepository {
  stages: DashboardStageRow[] = [];
  processes: DashboardProcessRow[] = [];
  processesForTiming: ProcessForStageTiming[] = [];
  stageChangeHistory: DashboardStageChangeRow[] = [];

  async listStages(): Promise<DashboardStageRow[]> {
    return this.stages;
  }

  async listProcesses(
    filters: Pick<DashboardFilters, 'organizationId'>,
  ): Promise<DashboardProcessRow[]> {
    if (!filters.organizationId) return this.processes;
    return this.processes.filter((row) => row.organizationId === filters.organizationId);
  }

  async listProcessesForStageTiming(): Promise<ProcessForStageTiming[]> {
    return this.processesForTiming;
  }

  async listStageChangeHistory(): Promise<DashboardStageChangeRow[]> {
    return this.stageChangeHistory;
  }
}
