import type {
  CompanySummary,
  ProcessBoardStageResult,
  ProcessDetail,
  ProcessDocumentSummary,
  ProcessHistoryEntry,
  ProcessListItem,
  StageSummary,
  UserSummary,
  UserSummaryWithEmail,
} from '@/domain/entities/process';
import type { ProcessIdentifier } from '@/domain/entities/process-identifier';
import type { ProcessPermissions } from '@/domain/entities/process-permissions';

/** Monta o DTO campo a campo — nunca `...process` (docs/06, checklist de segurança). */

interface CompanySummaryDto {
  id: string;
  cnpj: string | null;
  legalName: string;
}

function presentCompanySummary(company: CompanySummary): CompanySummaryDto {
  return { id: company.id, cnpj: company.cnpj, legalName: company.legalName };
}

interface StageSummaryDto {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
}

function presentStageSummary(stage: StageSummary): StageSummaryDto {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    order: stage.order,
    isFinal: stage.isFinal,
  };
}

interface UserSummaryDto {
  id: string;
  name: string;
}

function presentUserSummary(user: UserSummary): UserSummaryDto {
  return { id: user.id, name: user.name };
}

interface UserSummaryWithEmailDto extends UserSummaryDto {
  email: string;
}

function presentUserSummaryWithEmail(user: UserSummaryWithEmail): UserSummaryWithEmailDto {
  return { id: user.id, name: user.name, email: user.email };
}

interface ProcessListItemDto {
  id: string;
  code: string;
  reference: string;
  clientCompany: CompanySummaryDto;
  requestingCompany: CompanySummaryDto | null;
  currentStage: StageSummaryDto;
  responsible: UserSummaryDto | null;
  documentCount: number;
  source: string;
  requesterName: string | null;
  requesterEmail: string | null;
  receivedAt: string | null;
  /** Número da Opus no iLog ("31435/26"), quando o processo está vinculado (docs/15). */
  ilogNumber: string | null;
  stageChangedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export function presentProcessListItem(item: ProcessListItem): ProcessListItemDto {
  return {
    id: item.id,
    code: item.code,
    reference: item.reference,
    clientCompany: presentCompanySummary(item.clientCompany),
    requestingCompany: item.requestingCompany
      ? presentCompanySummary(item.requestingCompany)
      : null,
    currentStage: presentStageSummary(item.currentStage),
    responsible: item.responsible ? presentUserSummary(item.responsible) : null,
    documentCount: item.documentCount,
    source: item.source,
    requesterName: item.requesterName,
    requesterEmail: item.requesterEmail,
    receivedAt: item.receivedAt ? item.receivedAt.toISOString() : null,
    ilogNumber: item.ilogNumber,
    stageChangedAt: item.stageChangedAt.toISOString(),
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
  };
}

interface ProcessIdentifierDto {
  id: string;
  kind: string;
  value: string;
  source: string;
  createdAt: string;
}

function presentIdentifier(identifier: ProcessIdentifier): ProcessIdentifierDto {
  return {
    id: identifier.id,
    kind: identifier.kind,
    value: identifier.value,
    source: identifier.source,
    createdAt: identifier.createdAt.toISOString(),
  };
}

interface ProcessDocumentSummaryDto {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: UserSummaryDto;
  source: string;
  receivedAt: string | null;
  createdAt: string;
  downloadUrl: string;
}

function presentDocumentSummary(doc: ProcessDocumentSummary): ProcessDocumentSummaryDto {
  return {
    id: doc.id,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    uploadedBy: presentUserSummary(doc.uploadedBy),
    source: doc.source,
    receivedAt: doc.receivedAt ? doc.receivedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    downloadUrl: `/api/v1/documents/${doc.id}/download`,
  };
}

interface ProcessHistoryEntryDto {
  id: string;
  action: string;
  fromStage: { id: string; name: string } | null;
  toStage: { id: string; name: string } | null;
  actor: UserSummaryDto;
  description: string | null;
  createdAt: string;
}

export function presentHistoryEntry(entry: ProcessHistoryEntry): ProcessHistoryEntryDto {
  return {
    id: entry.id,
    action: entry.action,
    fromStage: entry.fromStage,
    toStage: entry.toStage,
    actor: presentUserSummary(entry.actor),
    description: entry.description,
    createdAt: entry.createdAt.toISOString(),
  };
}

interface ProcessPermissionsDto {
  canEdit: boolean;
  canMove: boolean;
  canDelete: boolean;
  canAssign: boolean;
  canUploadDocument: boolean;
}

function presentPermissions(permissions: ProcessPermissions): ProcessPermissionsDto {
  return { ...permissions };
}

interface ProcessDetailDto {
  id: string;
  code: string;
  reference: string;
  additionalInfo: string | null;
  clientCompany: CompanySummaryDto;
  requestingCompany: CompanySummaryDto | null;
  currentStage: StageSummaryDto;
  responsible: UserSummaryWithEmailDto | null;
  createdBy: UserSummaryDto;
  source: string;
  requesterName: string | null;
  requesterEmail: string | null;
  receivedAt: string | null;
  /** Vínculo com o iLog (docs/15): `null` nos três quando não vinculado. */
  ilogProcessId: number | null;
  ilogNumber: string | null;
  ilogSyncedAt: string | null;
  stageChangedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documents: ProcessDocumentSummaryDto[];
  history: ProcessHistoryEntryDto[];
  identifiers: ProcessIdentifierDto[];
  permissions: ProcessPermissionsDto;
}

export function presentProcessDetail(
  detail: ProcessDetail,
  permissions: ProcessPermissions,
): ProcessDetailDto {
  return {
    id: detail.id,
    code: detail.code,
    reference: detail.reference,
    additionalInfo: detail.additionalInfo,
    clientCompany: presentCompanySummary(detail.clientCompany),
    requestingCompany: detail.requestingCompany
      ? presentCompanySummary(detail.requestingCompany)
      : null,
    currentStage: presentStageSummary(detail.currentStage),
    responsible: detail.responsible ? presentUserSummaryWithEmail(detail.responsible) : null,
    createdBy: presentUserSummary(detail.createdBy),
    source: detail.source,
    requesterName: detail.requesterName,
    requesterEmail: detail.requesterEmail,
    receivedAt: detail.receivedAt ? detail.receivedAt.toISOString() : null,
    ilogProcessId: detail.ilogProcessId,
    ilogNumber: detail.ilogNumber,
    ilogSyncedAt: detail.ilogSyncedAt ? detail.ilogSyncedAt.toISOString() : null,
    stageChangedAt: detail.stageChangedAt.toISOString(),
    completedAt: detail.completedAt ? detail.completedAt.toISOString() : null,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    documents: detail.documents.map(presentDocumentSummary),
    history: detail.history.map(presentHistoryEntry),
    identifiers: detail.identifiers.map(presentIdentifier),
    permissions: presentPermissions(permissions),
  };
}

/** `POST /processes` devolve o processo criado "sem history e documents populados além do que já existe" (docs/05). */
export function presentProcessCreated(
  detail: ProcessDetail,
  permissions: ProcessPermissions,
): ProcessDetailDto {
  return presentProcessDetail(detail, permissions);
}

interface ProcessBoardStageDto extends StageSummaryDto {
  total: number;
  processes: ProcessListItemDto[];
}

interface ProcessBoardDto {
  stages: ProcessBoardStageDto[];
  generatedAt: string;
}

export function presentProcessBoard(stages: ProcessBoardStageResult[]): ProcessBoardDto {
  return {
    stages: stages.map((entry) => ({
      ...presentStageSummary(entry.stage),
      total: entry.total,
      processes: entry.processes.map(presentProcessListItem),
    })),
    generatedAt: new Date().toISOString(),
  };
}
