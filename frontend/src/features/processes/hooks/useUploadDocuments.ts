import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';

import { processKeys } from '@/features/processes/api/keys';
import { uploadDocuments } from '@/features/processes/api/process-api';

interface UploadArgs {
  processId: string;
  files: File[];
}

/**
 * `POST /processes/:id/documents` a partir da gaveta já aberta (docs/08,
 * "Gaveta de detalhe" — diferente do formulário de criação, aqui não há
 * "juntar localmente": o envio é incremental e imediato).
 */
export function useUploadDocuments(): UseMutationResult<unknown, unknown, UploadArgs> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ processId, files }: UploadArgs) => uploadDocuments(processId, files),
    onSuccess: (_data, { processId }) => {
      void queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
  });
}
