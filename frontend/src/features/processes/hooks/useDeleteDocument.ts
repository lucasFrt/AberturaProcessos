import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { App } from 'antd';

import { processKeys } from '@/features/processes/api/keys';
import { deleteDocument } from '@/features/processes/api/process-api';
import { translateError } from '@/shared/api/errors';

interface DeleteArgs {
  processId: string;
  documentId: string;
}

/** `DELETE /documents/:id` (docs/08, "Gaveta de detalhe" — aba Documentos). */
export function useDeleteDocument(): UseMutationResult<unknown, unknown, DeleteArgs> {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  return useMutation({
    mutationFn: ({ documentId }: DeleteArgs) => deleteDocument(documentId),
    onSuccess: (_data, { processId }) => {
      void queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (error) => {
      void message.error(translateError(error));
    },
  });
}
