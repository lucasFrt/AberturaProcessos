import type { DashboardFilters } from '@/domain/entities/dashboard';

/** Linha bruta de processo usada pelo service para montar totais/contagens (docs/05). */
export interface DashboardProcessRow {
  id: string;
  clientCompanyId: string;
  clientCompanyCnpj: string | null;
  clientCompanyLegalName: string;
  organizationId: string;
  organizationName: string;
  currentStageId: string;
  createdAt: Date;
  completedAt: Date | null;
}

/** Etapa para compor `byStage` mesmo quando a contagem é zero (docs/12, critério de aceite). */
export interface DashboardStageRow {
  id: string;
  name: string;
  color: string;
  order: number;
}

/** Entrada de histórico `STAGE_CHANGED` usada para derivar `averageTimePerStage` (docs/05). */
export interface DashboardStageChangeRow {
  processId: string;
  fromStageId: string | null;
  toStageId: string;
  createdAt: Date;
}

export interface ProcessForStageTiming {
  id: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface DashboardRepository {
  /** Todas as etapas cadastradas, ordenadas (docs/04) — base de `byStage`. */
  listStages(): Promise<DashboardStageRow[]>;

  /**
   * Processos não excluídos, filtrados por organização quando informado.
   * Sem filtro de período — os totais/agregações que precisam de período
   * aplicam o corte em memória a partir de `createdAt`/`completedAt`.
   */
  listProcesses(filters: Pick<DashboardFilters, 'organizationId'>): Promise<DashboardProcessRow[]>;

  /**
   * Todos os processos não excluídos (id, createdAt, completedAt), para
   * reconstrução da linha do tempo por etapa em memória — sem filtro de
   * organização/período (docs/12: "idealmente todos com histórico").
   */
  listProcessesForStageTiming(): Promise<ProcessForStageTiming[]>;

  /**
   * Entradas `STAGE_CHANGED` de todo o histórico, ordenadas por
   * `processId, createdAt asc`, em uma única query (evita N+1 — docs/12).
   */
  listStageChangeHistory(): Promise<DashboardStageChangeRow[]>;
}
