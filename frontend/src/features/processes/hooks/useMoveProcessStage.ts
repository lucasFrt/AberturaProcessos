import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { App } from 'antd';

import { processKeys } from '@/features/processes/api/keys';
import type { ProcessDetailDto } from '@/features/processes/api/process-api';
import { moveStage } from '@/features/processes/api/process-api';
import { translateError } from '@/shared/api/errors';

interface MoveArgs {
  processId: string;
  toStageId: string;
  note?: string | null;
}

/**
 * Variante não otimista de `PATCH /processes/:id/stage`, usada pelo botão
 * "Mover etapa" da gaveta (docs/08, "Gaveta de detalhe"). Diferente de
 * `useMoveStage` (board, docs/12 Tarefa 17), aqui não há snapshot de
 * coluna para atualizar localmente — só invalida detalhe e board ao
 * terminar, o que já converge para o estado do servidor.
 */
export function useMoveProcessStage(): UseMutationResult<ProcessDetailDto, unknown, MoveArgs> {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  return useMutation({
    mutationFn: ({ processId, toStageId, note }: MoveArgs) =>
      moveStage(processId, { toStageId, note }),
    onSuccess: (_data, { processId }) => {
      void queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (error) => {
      void message.error(translateError(error));
    },
  });
}
