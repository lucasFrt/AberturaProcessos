import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { App } from 'antd';

import { processKeys } from '@/features/processes/api/keys';
import type { BoardFilters, BoardResponse } from '@/features/processes/api/process-api';
import { moveStage as moveStageRequest } from '@/features/processes/api/process-api';
import { translateError } from '@/shared/api/errors';

interface MoveArgs {
  processId: string;
  toStageId: string;
  note?: string | null;
}

/** Move o card de coluna no snapshot local do board, sem esperar o servidor. */
function moveCard(
  board: BoardResponse | undefined,
  processId: string,
  toStageId: string,
): BoardResponse | undefined {
  if (!board) return board;

  let movedProcess: BoardResponse['stages'][number]['processes'][number] | undefined;
  const stagesWithoutCard = board.stages.map((stage) => {
    const found = stage.processes.find((process) => process.id === processId);
    if (!found) return stage;
    movedProcess = found;
    return {
      ...stage,
      total: stage.total - 1,
      processes: stage.processes.filter((process) => process.id !== processId),
    };
  });

  if (!movedProcess) return board;

  const updatedProcess = {
    ...movedProcess,
    stageChangedAt: new Date().toISOString(),
  };

  return {
    ...board,
    stages: stagesWithoutCard.map((stage) => {
      if (stage.id !== toStageId) return stage;
      return {
        ...stage,
        total: stage.total + 1,
        processes: [updatedProcess, ...stage.processes],
      };
    }),
  };
}

/**
 * Mutação otimista de movimentação de etapa (docs/08, "Board Kanban" —
 * bloco de código exato reproduzido aqui). `onMutate` cancela queries em
 * andamento, guarda o snapshot e já move o card na cache local;
 * `onError` devolve o snapshot anterior; `onSettled` sempre revalida
 * contra o servidor, o que também é a rede de segurança para o socket
 * (Tarefa 18).
 */
export function useMoveStage(
  filters: BoardFilters,
): UseMutationResult<unknown, unknown, MoveArgs, { previous: BoardResponse | undefined }> {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const boardKey = processKeys.board(filters);

  return useMutation({
    mutationFn: ({ processId, toStageId, note }: MoveArgs) =>
      moveStageRequest(processId, { toStageId, note }),

    onMutate: async ({ processId, toStageId }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<BoardResponse>(boardKey);
      queryClient.setQueryData<BoardResponse>(boardKey, (b) => moveCard(b, processId, toStageId));
      return { previous };
    },

    onError: (error, _vars, context) => {
      queryClient.setQueryData(boardKey, context?.previous); // devolve o card
      void message.error(translateError(error));
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: boardKey }),
  });
}
