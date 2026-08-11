import { Draggable, Droppable } from '@hello-pangea/dnd';
import { Badge, Button, Flex, Typography } from 'antd';
import type { ReactElement } from 'react';

import type { ProcessListItemDto } from '@/features/processes/api/process-api';
import { ProcessCard } from '@/features/processes/components/ProcessCard';

interface KanbanColumnProps {
  stageId: string;
  name: string;
  color: string;
  total: number;
  processes: ProcessListItemDto[];
  isDragDisabled: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * Coluna do board (docs/08, "Board Kanban"): cabeçalho com nome, bolinha
 * na cor da etapa e contador (`total`); "Carregar mais" quando
 * `total > processes.length`.
 */
export function KanbanColumn({
  stageId,
  name,
  color,
  total,
  processes,
  isDragDisabled,
  isLoadingMore,
  onLoadMore,
}: KanbanColumnProps): ReactElement {
  const hasMore = total > processes.length;

  return (
    <Flex
      vertical
      style={{
        width: 300,
        minWidth: 300,
        background: '#f5f5f5',
        borderRadius: 8,
        padding: 8,
      }}
    >
      <Flex align="center" gap={8} style={{ padding: '4px 4px 12px' }}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: color,
            display: 'inline-block',
          }}
        />
        <Typography.Text strong>{name}</Typography.Text>
        <Badge count={total} showZero color={color} />
      </Flex>

      <Droppable droppableId={stageId}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={{ minHeight: 40, flex: 1 }}
          >
            {processes.map((process, index) => (
              <Draggable
                key={process.id}
                draggableId={process.id}
                index={index}
                isDragDisabled={isDragDisabled}
              >
                {(dragProvided) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                  >
                    <ProcessCard process={process} />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {hasMore && (
        <Button type="link" loading={isLoadingMore} onClick={onLoadMore} block>
          Carregar mais
        </Button>
      )}
    </Flex>
  );
}
