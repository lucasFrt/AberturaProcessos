import type { KanbanStage } from '@/domain/entities/kanban-stage';
import type { KanbanStageWithCount } from '@/domain/repositories/kanban-stage-repository';

interface KanbanStageDto {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Monta o DTO campo a campo — nunca `...stage` (docs/06, checklist de segurança). */
export function presentKanbanStage(stage: KanbanStage): KanbanStageDto {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    order: stage.order,
    isFinal: stage.isFinal,
    createdAt: stage.createdAt.toISOString(),
    updatedAt: stage.updatedAt.toISOString(),
  };
}

interface KanbanStageWithCountDto extends KanbanStageDto {
  processCount: number;
}

export function presentKanbanStageWithCount(stage: KanbanStageWithCount): KanbanStageWithCountDto {
  return { ...presentKanbanStage(stage), processCount: stage.processCount };
}
