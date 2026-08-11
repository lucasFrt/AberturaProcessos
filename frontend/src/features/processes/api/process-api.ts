import { api } from '@/shared/api/http-client';

/** Payloads e chamadas de `/processes` usados pelo formulário de abertura (docs/05, "Processos"). */

export interface CreateProcessPayload {
  clientCompanyId: string;
  requestingCompanyId?: string | null;
  reference: string;
  additionalInfo?: string | null;
}

interface CompanySummaryDto {
  id: string;
  cnpj: string;
  legalName: string;
}

interface StageSummaryDto {
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
