import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  CreateKanbanStageData,
  KanbanStage,
  UpdateKanbanStageData,
} from '@/domain/entities/kanban-stage';

/** Etapa com a contagem de processos ativos no escopo do usuário (`?withCounts=true`, docs/05). */
export interface KanbanStageWithCount extends KanbanStage {
  processCount: number;
}

export interface KanbanStageRepository {
  findById(id: string): Promise<KanbanStage | null>;
  findByName(name: string): Promise<KanbanStage | null>;
  /** Ordenado por `order asc, name asc` (docs/04, "Reordenação de etapas"). */
  list(): Promise<KanbanStage[]>;
  listWithCounts(scope: AccessScope): Promise<KanbanStageWithCount[]>;
  /** Maior `order` cadastrado, ou `null` se não houver etapa — nova etapa entra em `max + 1`. */
  findMaxOrder(): Promise<number | null>;
  create(data: CreateKanbanStageData & { order: number }): Promise<KanbanStage>;
  update(id: string, data: UpdateKanbanStageData): Promise<KanbanStage>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
  /** Processos ativos (`deletedAt: null`) apontando para a etapa — bloqueia exclusão (docs/04). */
  countActiveProcesses(stageId: string): Promise<number>;
  /** Grava `order = índice` da lista recebida, em uma única transação (docs/04). */
  reorder(stageIds: string[]): Promise<KanbanStage[]>;
}
