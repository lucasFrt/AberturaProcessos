import type { HistoryAction, RecordSource } from '@/domain/enums';

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
  /** Origem (docs/13, decisão 7): WEB (formulário), EMAIL (intake), API (chave de API em rota comum). */
  source: RecordSource;
  /** Solicitante informado no e-mail — texto livre, não FK em User (docs/13). */
  requesterName: string | null;
  requesterEmail: string | null;
  /** Data de recebimento da solicitação (data do e-mail). `null` = igual a `createdAt`. */
  receivedAt: Date | null;
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
  source: RecordSource;
  requesterName: string | null;
  requesterEmail: string | null;
  receivedAt: Date | null;
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
  source: RecordSource;
  receivedAt: Date | null;
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
  source: RecordSource;
  requesterName: string | null;
  requesterEmail: string | null;
  receivedAt: Date | null;
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

/**
 * Reduz o detalhe agregado para o formato de item de listagem (docs/05,
 * payload de `process:created` — "`{ process: <item de listagem> }`").
 * Usado apenas na emissão do evento de tempo real, para não precisar de
 * uma segunda ida ao repositório só para montar o payload.
 */
export function toProcessListItem(detail: ProcessDetail): ProcessListItem {
  return {
    id: detail.id,
    code: detail.code,
    reference: detail.reference,
    clientCompany: detail.clientCompany,
    requestingCompany: detail.requestingCompany,
    currentStage: detail.currentStage,
    responsible: detail.responsible
      ? { id: detail.responsible.id, name: detail.responsible.name }
      : null,
    documentCount: detail.documents.length,
    source: detail.source,
    requesterName: detail.requesterName,
    requesterEmail: detail.requesterEmail,
    receivedAt: detail.receivedAt,
    stageChangedAt: detail.stageChangedAt,
    completedAt: detail.completedAt,
    createdAt: detail.createdAt,
  };
}

export interface CreateProcessWithHistoryInput {
  reference: string;
  additionalInfo: string | null;
  clientCompanyId: string;
  requestingCompanyId: string | null;
  currentStageId: string;
  createdById: string;
  source: RecordSource;
  requesterName: string | null;
  requesterEmail: string | null;
  receivedAt: Date | null;
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

/** Move de etapa (docs/05, `PATCH /processes/:id/stage`; RF-25, RF-27). */
export interface MoveStageWithHistoryInput {
  fromStageId: string;
  toStageId: string;
  /** Decidido pelo service (que já buscou a etapa destino) — o repositório só persiste. */
  toStageIsFinal: boolean;
  actorId: string;
  note?: string | null | undefined;
  description: string;
}

/** Atribuição de responsável (docs/05, `PATCH /processes/:id/responsible`; RF-26). */
export interface AssignResponsibleWithHistoryInput {
  responsibleId: string | null;
  actorId: string;
  description: string;
}

/** Exclusão lógica (docs/05, `DELETE /processes/:id`; RF-28). */
export interface SoftDeleteWithHistoryInput {
  actorId: string;
  description: string;
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
