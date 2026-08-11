import { api } from '@/shared/api/http-client';

/**
 * `GET /users/operational` (docs/05, "Usuários"): usuários ativos
 * OPERATIONAL/ADMIN, para popular seletores de responsável — acessível a
 * OPERATIONAL e ADMIN. Usado pelo filtro de responsável do board
 * (docs/12, Tarefa 17) e reaproveitado pela gaveta de detalhe (Tarefa 19).
 */
export interface OperationalUserDto {
  id: string;
  name: string;
  role: string;
}

export async function listOperationalUsers(): Promise<OperationalUserDto[]> {
  const { data } = await api.get<{ data: OperationalUserDto[] }>('/users/operational');
  return data.data;
}
