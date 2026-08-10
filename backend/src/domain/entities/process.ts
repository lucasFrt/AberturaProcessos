import type { HistoryAction } from '@/domain/enums';

/**
 * Entidade de domínio de Process (docs/04, model Process). Espelha as
 * colunas planas da tabela — os campos relacionados (empresa, etapa,
 * responsável) entram como objetos resumidos nos tipos de leitura
 * agregada (`ProcessListItem`, `ProcessDetail`), montados pelo repositório.
 */
export interface Process {
  id: string;
  code: string;
  reference: string;
  additionalInfo: string | null;
  clientCompanyId: string;
  requestingCompanyId: string | null;
  currentStageId: string;
  responsibleId: string | null;
  createdById: string;
  stageChangedAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
  deletedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanySummary {
  id: string;
  cnpj: string;
  legalName: string;
}

export interface StageSummary {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
}

export interface UserSummary {
  id: string;
  name: string;
}

export interface UserSummaryWithEmail extends UserSummary {
  email: string;
}

/** Item de listagem/board (docs/05, "GET /processes" e "GET /processes/board"). */
export interface ProcessListItem {
  id: string;
  code: string;
  reference: string;
  clientCompany: CompanySummary;
  requestingCompany: CompanySummary | null;
  currentStage: StageSummary;
  responsible: UserSummary | null;
  documentCount: number;
  stageChangedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}

export interface ProcessDocumentSummary {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: UserSummary;
  createdAt: Date;
}

export interface ProcessHistoryEntry {
  id: string;
  action: HistoryAction;
  fromStage: { id: string; name: string } | null;
  toStage: { id: string; name: string } | null;
  actor: UserSummary;
  description: string | null;
  metadata: string | null;
  createdAt: Date;
}

/** Detalhe agregado para a gaveta (docs/05, "GET /processes/:id"). */
export interface ProcessDetail {
  id: string;
  code: string;
  reference: string;
  additionalInfo: string | null;
  clientCompany: CompanySummary;
  requestingCompany: CompanySummary | null;
  currentStage: StageSummary;
  responsible: UserSummaryWithEmail | null;
  createdBy: UserSummary;
  stageChangedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  documents: ProcessDocumentSummary[];
  history: ProcessHistoryEntry[];
}

export interface ProcessBoardStageResult {
  stage: StageSummary;
  total: number;
  processes: ProcessListItem[];
}

export interface CreateProcessWithHistoryInput {
  reference: string;
  additionalInfo: string | null;
  clientCompanyId: string;
  requestingCompanyId: string | null;
  currentStageId: string;
  createdById: string;
}

export interface UpdateProcessData {
  reference?: string | undefined;
  additionalInfo?: string | null | undefined;
  clientCompanyId?: string | undefined;
  requestingCompanyId?: string | null | undefined;
}

/** Um campo alterado, para o `metadata` do histórico `PROCESS_UPDATED` (docs/05). */
export interface ProcessUpdateDiffEntry {
  field: string;
  from: unknown;
  to: unknown;
}

export interface UpdateProcessWithHistoryInput {
  data: UpdateProcessData;
  actorId: string;
  description: string;
  diff: ProcessUpdateDiffEntry[];
}

export interface ProcessFilters {
  stageId?: string | undefined;
  clientCompanyId?: string | undefined;
  responsibleId?: string | undefined;
  organizationId?: string | undefined;
  q?: string | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
}

export type ProcessSortField = 'createdAt' | 'stageChangedAt' | 'code';

export interface ProcessSort {
  field: ProcessSortField;
  order: 'asc' | 'desc';
}
