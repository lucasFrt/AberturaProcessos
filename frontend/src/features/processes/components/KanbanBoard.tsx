import { DragDropContext } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { App } from 'antd';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { processKeys } from '@/features/processes/api/keys';
import type {
  BoardFilters,
  BoardResponse,
  ProcessListItemDto,
} from '@/features/processes/api/process-api';
import { listProcesses } from '@/features/processes/api/process-api';
import { KanbanColumn } from '@/features/processes/components/KanbanColumn';
import { useMoveStage } from '@/features/processes/hooks/useMoveStage';
import { translateError } from '@/shared/api/errors';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface KanbanBoardProps {
  board: BoardResponse;
  filters: BoardFilters;
}

const LOAD_MORE_PAGE_SIZE = 50;

/**
 * `DragDropContext` + colunas (docs/08, "Board Kanban"). O
 * `@hello-pangea/dnd` já anuncia o drag via região `aria-live` por
 * padrão — nenhuma mensagem é suprimida aqui, então o suporte a teclado
 * (espaço para pegar, setas para mover, espaço para soltar) funciona sem
 * configuração extra.
 */
export function KanbanBoard({ board, filters }: KanbanBoardProps): ReactElement {
  const { has } = usePermissions();
  const canMove = has('process:move');
  const { mutate: moveStage } = useMoveStage(filters);
  const { message } = App.useApp();

  // Itens extras carregados via "Carregar mais", por coluna — não fazem
  // parte da query do board; são concatenados localmente (docs/05:
  // "carregar mais, que busca a página seguinte via GET /processes?stageId=...").
  const [extraByStage, setExtraByStage] = useState<Record<string, ProcessListItemDto[]>>({});
  const [loadingStageId, setLoadingStageId] = useState<string | null>(null);

  // Ao trocar filtros, o acumulado de "carregar mais" não corresponde mais
  // ao novo recorte. Reset ajustado durante a renderização (padrão oficial
  // do React para "resetar estado quando um prop muda"), não em efeito —
  // evita o aviso de setState síncrono dentro de useEffect.
  const boardQueryKey = JSON.stringify(processKeys.board(filters));
  const [previousBoardQueryKey, setPreviousBoardQueryKey] = useState(boardQueryKey);
  if (previousBoardQueryKey !== boardQueryKey) {
    setPreviousBoardQueryKey(boardQueryKey);
    setExtraByStage({});
  }

  function handleDragEnd(result: DropResult): void {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;

    moveStage({ processId: draggableId, toStageId: destination.droppableId });
  }

  async function handleLoadMore(stageId: string): Promise<void> {
    const stage = board.stages.find((entry) => entry.id === stageId);
    if (!stage) return;

    const alreadyLoaded = stage.processes.length + (extraByStage[stageId]?.length ?? 0);
    const nextPage = Math.floor(alreadyLoaded / LOAD_MORE_PAGE_SIZE) + 1;

    setLoadingStageId(stageId);
    try {
      const response = await listProcesses({
        ...filters,
        stageId,
        page: nextPage,
        pageSize: LOAD_MORE_PAGE_SIZE,
      });
      setExtraByStage((current) => ({
        ...current,
        [stageId]: [...(current[stageId] ?? []), ...response.data],
      }));
    } catch (error) {
      void message.error(translateError(error));
    } finally {
      setLoadingStageId(null);
    }
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
        {board.stages
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((stage) => (
            <KanbanColumn
              key={stage.id}
              stageId={stage.id}
              name={stage.name}
              color={stage.color}
              total={stage.total}
              processes={[...stage.processes, ...(extraByStage[stage.id] ?? [])]}
              isDragDisabled={!canMove}
              isLoadingMore={loadingStageId === stage.id}
              onLoadMore={() => void handleLoadMore(stage.id)}
            />
          ))}
      </div>
    </DragDropContext>
  );
}
