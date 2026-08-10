/** Etapa do funil Kanban (docs/04, model KanbanStage). Global, gerenciada por ADMIN. */
export interface KanbanStage {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKanbanStageData {
  name: string;
  color?: string | undefined;
  isFinal?: boolean | undefined;
}

export interface UpdateKanbanStageData {
  name?: string | undefined;
  color?: string | undefined;
  isFinal?: boolean | undefined;
}
