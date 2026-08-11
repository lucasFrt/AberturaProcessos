import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';

import { processKeys } from '@/features/processes/api/keys';
import type { ProcessDetailDto, UpdateProcessPayload } from '@/features/processes/api/process-api';
import { updateProcess } from '@/features/processes/api/process-api';

interface UpdateArgs {
  processId: string;
  payload: UpdateProcessPayload;
}

/**
 * `PATCH /processes/:id` (docs/08, "Gaveta de detalhe" — edição inline de
 * referência/adicionais no blur). Sem otimismo: o campo já mostra o valor
 * digitado localmente enquanto salva, então basta invalidar o detalhe (e
 * o board, que também exibe referência) ao terminar.
 */
export function useUpdateProcess(): UseMutationResult<ProcessDetailDto, unknown, UpdateArgs> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ processId, payload }: UpdateArgs) => updateProcess(processId, payload),
    onSuccess: (_data, { processId }) => {
      void queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
  });
}
