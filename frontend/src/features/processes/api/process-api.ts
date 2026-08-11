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

/** `PATCH /processes/:id/stage` (docs/05). Devolve o detalhe do processo já na etapa nova. */
export async function moveStage(
  processId: string,
  payload: MoveStagePayload,
): Promise<ProcessDetailResponse> {
  const { data } = await api.patch<ProcessDetailResponse>(`/processes/${processId}/stage`, payload);
  return data;
}
