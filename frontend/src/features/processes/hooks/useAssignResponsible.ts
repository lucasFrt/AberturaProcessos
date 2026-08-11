import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { App } from 'antd';

import { processKeys } from '@/features/processes/api/keys';
import type { ProcessDetailDto } from '@/features/processes/api/process-api';
import { assignResponsible } from '@/features/processes/api/process-api';
import { translateError } from '@/shared/api/errors';

interface AssignArgs {
  processId: string;
  responsibleId: string | null;
}

/** `PATCH /processes/:id/responsible` (docs/08, "Gaveta de detalhe"). */
export function useAssignResponsible(): UseMutationResult<ProcessDetailDto, unknown, AssignArgs> {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  return useMutation({
    mutationFn: ({ processId, responsibleId }: AssignArgs) =>
      assignResponsible(processId, responsibleId),
    onSuccess: (_data, { processId }) => {
      void queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (error) => {
      void message.error(translateError(error));
    },
  });
}
