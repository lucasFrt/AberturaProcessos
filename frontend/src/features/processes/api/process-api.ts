import { api } from '@/shared/api/http-client';

/** Payloads e chamadas de `/processes` usados pelo formulário de abertura (docs/05, "Processos"). */

export interface CreateProcessPayload {
  clientCompanyId: string;
  requestingCompanyId?: string | null;
  reference: string;
  additionalInfo?: string | null;
}

export interface CompanySummaryDto {
  id: string;
  cnpj: string;
  legalName: string;
}

export interface StageSummaryDto {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
}

/** Formato de `POST /processes` (mesmo shape de `GET /processes/:id`, docs/05). */
export interface ProcessDetailResponse {
  id: string;
  code: string;
  reference: string;
  additionalInfo: string | null;
  clientCompany: CompanySummaryDto;
  requestingCompany: CompanySummaryDto | null;
  currentStage: StageSummaryDto;
}

export async function createProcess(payload: CreateProcessPayload): Promise<ProcessDetailResponse> {
  const { data } = await api.post<ProcessDetailResponse>('/processes', payload);
  return data;
}

interface UploadedDocumentDto {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

/** `POST /processes/:id/documents`, multipart com campo "files" (docs/05, "Documentos"). */
export async function uploadDocuments(
  processId: string,
  files: File[],
): Promise<UploadedDocumentDto[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));

  const { data } = await api.post<{ data: UploadedDocumentDto[] }>(
    `/processes/${processId}/documents`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data.data;
}

/** Item de listagem — mesmo formato de `GET /processes` e das colunas de `GET /processes/board` (docs/05). */
export interface ProcessListItemDto {
  id: string;
  code: string;
  reference: string;
  clientCompany: CompanySummaryDto;
  requestingCompany: CompanySummaryDto | null;
  currentStage: StageSummaryDto;
  responsible: { id: string; name: string } | null;
  documentCount: number;
  stageChangedAt: string;
  completedAt: string | null;
  createdAt: string;
}

/** Filtros comuns a `GET /processes` e `GET /processes/board` (docs/05). */
export interface CommonProcessFilters {
  clientCompanyId?: string;
  responsibleId?: string;
  organizationId?: string;
  q?: string;
  createdFrom?: string;
  createdTo?: string;
}

export type BoardFilters = CommonProcessFilters;

export interface ListProcessesFilters extends CommonProcessFilters {
  stageId?: string;
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'stageChangedAt' | 'code';
  order?: 'asc' | 'desc';
}

interface ProcessBoardStageDto extends StageSummaryDto {
  total: number;
  processes: ProcessListItemDto[];
}

/** Formato de `GET /processes/board` (docs/05). */
export interface BoardResponse {
  stages: ProcessBoardStageDto[];
  generatedAt: string;
}

export async function getBoard(
  filters: BoardFilters,
  limitPerStage?: number,
): Promise<BoardResponse> {
  const { data } = await api.get<BoardResponse>('/processes/board', {
    params: { ...filters, limitPerStage },
  });
  return data;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export async function listProcesses(
  filters: ListProcessesFilters,
): Promise<PaginatedResponse<ProcessListItemDto>> {
  const { data } = await api.get<PaginatedResponse<ProcessListItemDto>>('/processes', {
    params: filters,
  });
  return data;
}

export interface MoveStagePayload {
  toStageId: string;
  note?: string | null;
}

/** `PATCH /processes/:id/stage` (docs/05). Devolve o detalhe completo do processo já na etapa nova. */
export async function moveStage(
  processId: string,
  payload: MoveStagePayload,
): Promise<ProcessDetailDto> {
  const { data } = await api.patch<ProcessDetailDto>(`/processes/${processId}/stage`, payload);
  return data;
}

export interface ProcessPermissionsDto {
  canEdit: boolean;
  canMove: boolean;
  canDelete: boolean;
  canAssign: boolean;
  canUploadDocument: boolean;
}

export interface ProcessDocumentDto {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  downloadUrl: string;
}

export interface ProcessHistoryStageRefDto {
  id: string;
  name: string;
}

export interface ProcessHistoryEntryDto {
  id: string;
  action:
    | 'PROCESS_CREATED'
    | 'PROCESS_UPDATED'
    | 'STAGE_CHANGED'
    | 'RESPONSIBLE_CHANGED'
    | 'DOCUMENT_ADDED'
    | 'DOCUMENT_REMOVED'
    | 'PROCESS_DELETED';
  fromStage: ProcessHistoryStageRefDto | null;
  toStage: ProcessHistoryStageRefDto | null;
  actor: { id: string; name: string };
  description: string | null;
  createdAt: string;
}

/** Formato completo de `GET /processes/:id` (docs/05, "Detalhe agregado para a gaveta"). */
export interface ProcessDetailDto {
  id: string;
  code: string;
  reference: string;
  additionalInfo: string | null;
  clientCompany: CompanySummaryDto;
  requestingCompany: CompanySummaryDto | null;
  currentStage: StageSummaryDto;
  responsible: { id: string; name: string; email: string } | null;
  createdBy: { id: string; name: string };
  stageChangedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documents: ProcessDocumentDto[];
  history: ProcessHistoryEntryDto[];
  permissions: ProcessPermissionsDto;
}

/** `GET /processes/:id` (docs/05). Detalhe agregado usado pela gaveta (Tarefa 19). */
export async function getProcessDetail(processId: string): Promise<ProcessDetailDto> {
  const { data } = await api.get<ProcessDetailDto>(`/processes/${processId}`);
  return data;
}

export interface UpdateProcessPayload {
  reference?: string;
  additionalInfo?: string | null;
  clientCompanyId?: string;
  requestingCompanyId?: string | null;
}

/** `PATCH /processes/:id` (docs/05). Usado pela edição inline da aba "Dados". */
export async function updateProcess(
  processId: string,
  payload: UpdateProcessPayload,
): Promise<ProcessDetailDto> {
  const { data } = await api.patch<ProcessDetailDto>(`/processes/${processId}`, payload);
  return data;
}

/** `PATCH /processes/:id/responsible` (docs/05). `responsibleId: null` desatribui. */
export async function assignResponsible(
  processId: string,
  responsibleId: string | null,
): Promise<ProcessDetailDto> {
  const { data } = await api.patch<ProcessDetailDto>(`/processes/${processId}/responsible`, {
    responsibleId,
  });
  return data;
}

interface PaginatedHistoryResponse {
  data: ProcessHistoryEntryDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

/** `GET /processes/:id/history` (docs/05). Trilha paginada em ordem cronológica. */
export async function getProcessHistory(
  processId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<PaginatedHistoryResponse> {
  const { data } = await api.get<PaginatedHistoryResponse>(`/processes/${processId}/history`, {
    params,
  });
  return data;
}

/**
 * Download via `fetch` + `blob` (docs/08, "Gaveta de detalhe"): `<a>` não
 * envia o header `Authorization`, então o binário é baixado pela própria
 * instância axios (que já injeta o bearer token) e o download é disparado
 * por um link temporário com `URL.createObjectURL`, revogado depois.
 */
export async function downloadDocument(documentId: string, originalName: string): Promise<void> {
  const response = await api.get<Blob>(`/documents/${documentId}/download`, {
    responseType: 'blob',
  });

  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = originalName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** `DELETE /documents/:id` (docs/05). Exclusão lógica. */
export async function deleteDocument(documentId: string): Promise<void> {
  await api.delete(`/documents/${documentId}`);
}
