import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { processKeys } from '@/features/processes/api/keys';
import type { ProcessDetailDto } from '@/features/processes/api/process-api';
import { getProcessDetail } from '@/features/processes/api/process-api';

/**
 * `GET /processes/:id` (docs/08, "Gaveta de detalhe"). Chave de query
 * compartilhada com o board/tempo real (`processKeys.detail`), para que a
 * invalidação disparada por eventos de socket (Tarefa 18) atualize a
 * gaveta aberta sem recarregar a página.
 */
export function useProcessDetail(processId: string | undefined): UseQueryResult<ProcessDetailDto> {
  return useQuery({
    queryKey: processKeys.detail(processId ?? ''),
    queryFn: () => getProcessDetail(processId as string),
    enabled: Boolean(processId),
  });
}
