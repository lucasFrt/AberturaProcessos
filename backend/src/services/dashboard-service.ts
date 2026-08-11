import type {
  DashboardCompanyCount,
  DashboardCompletionTime,
  DashboardFilters,
  DashboardMetrics,
  DashboardOrganizationCount,
  DashboardStageAverage,
  DashboardStageCount,
  DashboardThroughputDay,
  DashboardTotals,
} from '@/domain/entities/dashboard';
import type {
  DashboardProcessRow,
  DashboardRepository,
  DashboardStageChangeRow,
  ProcessForStageTiming,
} from '@/domain/repositories/dashboard-repository';

const MS_PER_HOUR = 60 * 60 * 1000;

export interface DashboardServiceDeps {
  dashboardRepository: DashboardRepository;
}

/** `[from, to]` inclusivo — evita perder o dia final por causa da hora zero (docs/05). */
function isWithinPeriod(date: Date, from: Date, to: Date): boolean {
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

/** "5d 12h" a partir de horas fracionárias (docs/05, `completionTime.formatted`). */
function formatDaysHours(totalHours: number): string {
  const totalWholeHours = Math.round(totalHours);
  const days = Math.floor(totalWholeHours / 24);
  const hours = totalWholeHours % 24;
  return `${days}d ${hours}h`;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildTotals(rows: DashboardProcessRow[], from: Date, to: Date): DashboardTotals {
  let active = 0;
  let completed = 0;
  let createdInPeriod = 0;
  let completedInPeriod = 0;

  for (const row of rows) {
    if (row.completedAt) {
      completed += 1;
    } else {
      active += 1;
    }
    if (isWithinPeriod(row.createdAt, from, to)) {
      createdInPeriod += 1;
    }
    if (row.completedAt && isWithinPeriod(row.completedAt, from, to)) {
      completedInPeriod += 1;
    }
  }

  return {
    processes: rows.length,
    active,
    completed,
    createdInPeriod,
    completedInPeriod,
  };
}

function buildByStage(
  rows: DashboardProcessRow[],
  stages: { id: string; name: string; color: string; order: number }[],
): DashboardStageCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.currentStageId, (counts.get(row.currentStageId) ?? 0) + 1);
  }

  return stages.map((stage) => ({
    stageId: stage.id,
    stageName: stage.name,
    color: stage.color,
    order: stage.order,
    count: counts.get(stage.id) ?? 0,
  }));
}

/** `byCompany`/`byOrganization` restritos ao período de criação (`createdAt` em `[from, to]`). */
function buildByCompany(
  rows: DashboardProcessRow[],
  from: Date,
  to: Date,
): DashboardCompanyCount[] {
  const inPeriod = rows.filter((row) => isWithinPeriod(row.createdAt, from, to));

  const byCompany = new Map<string, DashboardCompanyCount>();
  for (const row of inPeriod) {
    const existing = byCompany.get(row.clientCompanyId);
    if (existing) {
      existing.count += 1;
    } else {
      byCompany.set(row.clientCompanyId, {
        companyId: row.clientCompanyId,
        cnpj: row.clientCompanyCnpj,
        legalName: row.clientCompanyLegalName,
        count: 1,
      });
    }
  }

  return [...byCompany.values()].sort((a, b) => b.count - a.count);
}

function buildByOrganization(
  rows: DashboardProcessRow[],
  from: Date,
  to: Date,
): DashboardOrganizationCount[] {
  const inPeriod = rows.filter((row) => isWithinPeriod(row.createdAt, from, to));

  const byOrganization = new Map<string, DashboardOrganizationCount>();
  for (const row of inPeriod) {
    const existing = byOrganization.get(row.organizationId);
    if (existing) {
      existing.count += 1;
    } else {
      byOrganization.set(row.organizationId, {
        organizationId: row.organizationId,
        name: row.organizationName,
        count: 1,
      });
    }
  }

  return [...byOrganization.values()].sort((a, b) => b.count - a.count);
}

function buildCompletionTime(
  rows: DashboardProcessRow[],
  from: Date,
  to: Date,
): DashboardCompletionTime {
  const hours = rows
    .filter((row) => row.completedAt && isWithinPeriod(row.completedAt, from, to))
    .map((row) => (row.completedAt!.getTime() - row.createdAt.getTime()) / MS_PER_HOUR);

  if (hours.length === 0) {
    return { averageHours: 0, medianHours: 0, formatted: '0d 0h', sampleSize: 0 };
  }

  const averageHours = average(hours);
  const medianHours = median(hours);

  return {
    averageHours,
    medianHours,
    formatted: formatDaysHours(averageHours),
    sampleSize: hours.length,
  };
}

/**
 * Reconstrói, por processo, a sequência cronológica de `STAGE_CHANGED` (a
 * primeira entrada medida a partir de `createdAt`) e agrega a duração de
 * cada etapa por `stageId`. A etapa atual de um processo em aberto (sem
 * `completedAt`) não entra na média — o tempo está em curso (docs/05,
 * docs/12 critério de aceite da Tarefa 14).
 */
function buildAverageTimePerStage(
  processes: ProcessForStageTiming[],
  history: DashboardStageChangeRow[],
  stages: { id: string; name: string }[],
  allowedProcessIds: Set<string> | null,
): DashboardStageAverage[] {
  const stageNameById = new Map(stages.map((stage) => [stage.id, stage.name]));
  const scopedProcesses = allowedProcessIds
    ? processes.filter((process) => allowedProcessIds.has(process.id))
    : processes;
  const processById = new Map(scopedProcesses.map((process) => [process.id, process]));

  const historyByProcess = new Map<string, DashboardStageChangeRow[]>();
  for (const entry of history) {
    const list = historyByProcess.get(entry.processId);
    if (list) {
      list.push(entry);
    } else {
      historyByProcess.set(entry.processId, [entry]);
    }
  }

  const durationsByStage = new Map<string, number[]>();

  function addDuration(stageId: string, hours: number): void {
    const list = durationsByStage.get(stageId);
    if (list) {
      list.push(hours);
    } else {
      durationsByStage.set(stageId, [hours]);
    }
  }

  for (const [processId, entries] of historyByProcess) {
    const process = processById.get(processId);
    if (!process) continue;

    // `entries` já vem ordenado por createdAt asc do repositório. Cada
    // entrada `STAGE_CHANGED` marca a SAÍDA de `fromStageId` e a ENTRADA
    // em `toStageId` no instante `createdAt`; a duração de `fromStageId`
    // é o intervalo entre quando o processo entrou nela (primeira medida
    // a partir de `createdAt` do processo) e este instante.
    let previousTimestamp = process.createdAt;
    let lastStageId: string | null = null;

    for (const entry of entries) {
      if (entry.fromStageId) {
        const hours = (entry.createdAt.getTime() - previousTimestamp.getTime()) / MS_PER_HOUR;
        addDuration(entry.fromStageId, hours);
      }
      previousTimestamp = entry.createdAt;
      lastStageId = entry.toStageId;
    }

    // Etapa atual: só entra na média se o processo já está concluído —
    // caso contrário o tempo ainda está em curso (docs/12).
    if (lastStageId && process.completedAt) {
      const hours = (process.completedAt.getTime() - previousTimestamp.getTime()) / MS_PER_HOUR;
      addDuration(lastStageId, hours);
    }
  }

  return stages
    .map((stage) => {
      const durations = durationsByStage.get(stage.id) ?? [];
      return {
        stageId: stage.id,
        stageName: stageNameById.get(stage.id) ?? stage.name,
        averageHours: average(durations),
        sampleSize: durations.length,
      };
    })
    .filter((entry) => entry.sampleSize > 0);
}

function buildThroughputByDay(
  rows: DashboardProcessRow[],
  from: Date,
  to: Date,
): DashboardThroughputDay[] {
  const createdByDay = new Map<string, number>();
  const completedByDay = new Map<string, number>();

  for (const row of rows) {
    if (isWithinPeriod(row.createdAt, from, to)) {
      const key = toDateKey(row.createdAt);
      createdByDay.set(key, (createdByDay.get(key) ?? 0) + 1);
    }
    if (row.completedAt && isWithinPeriod(row.completedAt, from, to)) {
      const key = toDateKey(row.completedAt);
      completedByDay.set(key, (completedByDay.get(key) ?? 0) + 1);
    }
  }

  const days: DashboardThroughputDay[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  while (cursor.getTime() <= end.getTime()) {
    const key = toDateKey(cursor);
    days.push({
      date: key,
      created: createdByDay.get(key) ?? 0,
      completed: completedByDay.get(key) ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

/**
 * Métricas agregadas do dashboard (RF-60 a RF-63; docs/05 seção "Dashboard
 * (ADMIN)"). Restrito a ADMIN pelo `authorize('ADMIN')` na rota, não aqui
 * — o service não conhece papel/Express.
 */
export class DashboardService {
  constructor(private readonly deps: DashboardServiceDeps) {}

  async getMetrics(filters: DashboardFilters): Promise<DashboardMetrics> {
    const { from, to, organizationId } = filters;

    const [stages, processes, processesForTiming, stageChangeHistory] = await Promise.all([
      this.deps.dashboardRepository.listStages(),
      this.deps.dashboardRepository.listProcesses({ organizationId }),
      this.deps.dashboardRepository.listProcessesForStageTiming(),
      this.deps.dashboardRepository.listStageChangeHistory(),
    ]);

    return {
      period: { from, to },
      totals: buildTotals(processes, from, to),
      byStage: buildByStage(processes, stages),
      byCompany: buildByCompany(processes, from, to),
      byOrganization: buildByOrganization(processes, from, to),
      completionTime: buildCompletionTime(processes, from, to),
      averageTimePerStage: buildAverageTimePerStage(
        processesForTiming,
        stageChangeHistory,
        stages,
        organizationId ? new Set(processes.map((row) => row.id)) : null,
      ),
      throughputByDay: buildThroughputByDay(processes, from, to),
    };
  }
}
