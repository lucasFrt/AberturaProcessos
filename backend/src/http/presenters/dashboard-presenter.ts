import type { DashboardMetrics } from '@/domain/entities/dashboard';

interface DashboardMetricsDto {
  period: { from: string; to: string };
  totals: {
    processes: number;
    active: number;
    completed: number;
    createdInPeriod: number;
    completedInPeriod: number;
  };
  byStage: Array<{
    stageId: string;
    stageName: string;
    color: string;
    order: number;
    count: number;
  }>;
  byCompany: Array<{ companyId: string; cnpj: string; legalName: string; count: number }>;
  byOrganization: Array<{ organizationId: string; name: string; count: number }>;
  completionTime: {
    averageHours: number;
    medianHours: number;
    formatted: string;
    sampleSize: number;
  };
  averageTimePerStage: Array<{
    stageId: string;
    stageName: string;
    averageHours: number;
    sampleSize: number;
  }>;
  throughputByDay: Array<{ date: string; created: number; completed: number }>;
}

/** Monta o DTO campo a campo (docs/06, checklist de segurança) no formato de docs/05. */
export function presentDashboardMetrics(metrics: DashboardMetrics): DashboardMetricsDto {
  return {
    period: {
      from: metrics.period.from.toISOString().slice(0, 10),
      to: metrics.period.to.toISOString().slice(0, 10),
    },
    totals: {
      processes: metrics.totals.processes,
      active: metrics.totals.active,
      completed: metrics.totals.completed,
      createdInPeriod: metrics.totals.createdInPeriod,
      completedInPeriod: metrics.totals.completedInPeriod,
    },
    byStage: metrics.byStage.map((stage) => ({
      stageId: stage.stageId,
      stageName: stage.stageName,
      color: stage.color,
      order: stage.order,
      count: stage.count,
    })),
    byCompany: metrics.byCompany.map((company) => ({
      companyId: company.companyId,
      cnpj: company.cnpj,
      legalName: company.legalName,
      count: company.count,
    })),
    byOrganization: metrics.byOrganization.map((organization) => ({
      organizationId: organization.organizationId,
      name: organization.name,
      count: organization.count,
    })),
    completionTime: {
      averageHours: metrics.completionTime.averageHours,
      medianHours: metrics.completionTime.medianHours,
      formatted: metrics.completionTime.formatted,
      sampleSize: metrics.completionTime.sampleSize,
    },
    averageTimePerStage: metrics.averageTimePerStage.map((stage) => ({
      stageId: stage.stageId,
      stageName: stage.stageName,
      averageHours: stage.averageHours,
      sampleSize: stage.sampleSize,
    })),
    throughputByDay: metrics.throughputByDay.map((day) => ({
      date: day.date,
      created: day.created,
      completed: day.completed,
    })),
  };
}
