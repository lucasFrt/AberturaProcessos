import { api } from '@/shared/api/http-client';

/**
 * `GET /stages` (docs/05, "Etapas do Kanban"). Leitura liberada para
 * qualquer usuário autenticado. Usado pelo seletor de etapa destino do
 * modal "Mover etapa" da gaveta de detalhe (docs/08, Tarefa 19); a
 * administração completa de etapas fica para a Tarefa 20.
 */
export interface StageDto {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
}

export async function listStages(): Promise<StageDto[]> {
  const { data } = await api.get<{ data: StageDto[] }>('/stages');
  return data.data;
}
