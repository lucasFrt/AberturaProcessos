import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { processKeys } from '@/features/processes/api/keys';
import type { BoardFilters, BoardResponse } from '@/features/processes/api/process-api';
import { getBoard } from '@/features/processes/api/process-api';

/**
 * `GET /processes/board` (docs/08, "Board Kanban"). Os filtros entram na
 * própria chave de query (`processKeys.board`), então trocar um filtro
 * dispara um novo fetch e não reaproveita cache de outra combinação.
 */
export function useBoard(filters: BoardFilters): UseQueryResult<BoardResponse> {
  return useQuery({
    queryKey: processKeys.board(filters),
    queryFn: () => getBoard(filters),
  });
}
