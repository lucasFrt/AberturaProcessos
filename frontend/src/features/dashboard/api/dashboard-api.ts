import { api } from '@/shared/api/http-client';

/**
 * `GET /dashboard/metrics` (docs/05, "Dashboard (ADMIN)"; docs/12, Tarefa
 * 21). Formato de resposta espelha exatamente
 * `backend/src/http/presenters/dashboard-presenter.ts`.
 */

export interface DashboardMetricsFilters {
  from?: string;
  to?: string;
  organizationId?: string;
}

export interface DashboardStageMetricDto {
  stageId: string;
  stageName: string;
  color: string;
  order: number;
  count: number;
}

export interface DashboardCompanyMetricDto {
  companyId: string;
  cnpj: string | null;
  legalName: string;
  count: number;
}

export interface DashboardOrganizationMetricDto {
  organizationId: string;
  name: string;
  count: number;
}

export interface DashboardCompletionTimeDto {
  averageHours: number;
  medianHours: number;
  formatted: string;
  sampleSize: number;
}

export interface DashboardAverageTimePerStageDto {
  stageId: string;
  stageName: string;
  averageHours: number;
  sampleSize: number;
}

export interface DashboardThroughputDayDto {
  date: string;
  created: number;
  completed: number;
}

export interface DashboardMetricsDto {
  period: { from: string; to: string };
  totals: {
    processes: number;
    active: number;
    completed: number;
    createdInPeriod: number;
    completedInPeriod: number;
  };
  byStage: DashboardStageMetricDto[];
  byCompany: DashboardCompanyMetricDto[];
  byOrganization: DashboardOrganizationMetricDto[];
  completionTime: DashboardCompletionTimeDto;
  averageTimePerStage: DashboardAverageTimePerStageDto[];
  throughputByDay: DashboardThroughputDayDto[];
}

export async function getDashboardMetrics(
  filters: DashboardMetricsFilters = {},
): Promise<DashboardMetricsDto> {
  const { data } = await api.get<DashboardMetricsDto>('/dashboard/metrics', {
    params: filters,
  });
  return data;
}
