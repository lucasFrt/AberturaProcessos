/**
 * Métricas agregadas do dashboard gerencial (RF-60 a RF-63; docs/05 seção
 * "Dashboard (ADMIN)"). Todo campo aqui espelha exatamente o formato do
 * contrato — o presenter apenas serializa datas, não decide formato.
 */
export interface DashboardFilters {
  from: Date;
  to: Date;
  organizationId?: string | undefined;
}

export interface DashboardTotals {
  processes: number;
  active: number;
  completed: number;
  createdInPeriod: number;
  completedInPeriod: number;
}

export interface DashboardStageCount {
  stageId: string;
  stageName: string;
  color: string;
  order: number;
  count: number;
}

export interface DashboardCompanyCount {
  companyId: string;
  cnpj: string;
  legalName: string;
  count: number;
}

export interface DashboardOrganizationCount {
  organizationId: string;
  name: string;
  count: number;
}

export interface DashboardCompletionTime {
  averageHours: number;
  medianHours: number;
  formatted: string;
  sampleSize: number;
}

export interface DashboardStageAverage {
  stageId: string;
  stageName: string;
  averageHours: number;
  sampleSize: number;
}

export interface DashboardThroughputDay {
  date: string;
  created: number;
  completed: number;
}

export interface DashboardMetrics {
  period: { from: Date; to: Date };
  totals: DashboardTotals;
  byStage: DashboardStageCount[];
  byCompany: DashboardCompanyCount[];
  byOrganization: DashboardOrganizationCount[];
  completionTime: DashboardCompletionTime;
  averageTimePerStage: DashboardStageAverage[];
  throughputByDay: DashboardThroughputDay[];
}
