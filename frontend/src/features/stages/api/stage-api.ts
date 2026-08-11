import { api } from '@/shared/api/http-client';

/**
 * API de etapas (docs/05, "Etapas do Kanban"). Leitura liberada para
 * qualquer usuário autenticado; escrita restrita a ADMIN.
 */
export interface StageDto {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
  processCount?: number;
}

export async function listStages(withCounts?: boolean): Promise<StageDto[]> {
  const { data } = await api.get<{ data: StageDto[] }>('/stages', {
    params: withCounts ? { withCounts: 'true' } : undefined,
  });
  return data.data;
}

export interface CreateStagePayload {
  name: string;
  color?: string;
  isFinal?: boolean;
}

export async function createStage(payload: CreateStagePayload): Promise<StageDto> {
  const { data } = await api.post<StageDto>('/stages', payload);
  return data;
}

export interface UpdateStagePayload {
  name?: string;
  color?: string;
  isFinal?: boolean;
}

export async function updateStage(id: string, payload: UpdateStagePayload): Promise<StageDto> {
  const { data } = await api.patch<StageDto>(`/stages/${id}`, payload);
  return data;
}

export async function deleteStage(id: string): Promise<void> {
  await api.delete(`/stages/${id}`);
}

export async function reorderStages(stageIds: string[]): Promise<void> {
  await api.patch('/stages/reorder', { stageIds });
}
