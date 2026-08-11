import type { BoardFilters, ListProcessesFilters } from '@/features/processes/api/process-api';

/**
 * Chaves de query centralizadas (docs/08, "Estado"), para que invalidação
 * e leitura não divirjam. A Tarefa 18 (tempo real) e a 19 (gaveta) reusam
 * `board` e `detail` para invalidar cache a partir de eventos de socket.
 */
export const processKeys = {
  all: ['processes'] as const,
  board: (filters: BoardFilters) => ['board', filters] as const,
  list: (filters: ListProcessesFilters) => ['processes', 'list', filters] as const,
  detail: (id: string) => ['process', id] as const,
};
