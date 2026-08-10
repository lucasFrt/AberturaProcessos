import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  AssignResponsibleWithHistoryInput,
  CreateProcessWithHistoryInput,
  MoveStageWithHistoryInput,
  Process,
  ProcessBoardStageResult,
  ProcessDetail,
  ProcessFilters,
  ProcessHistoryEntry,
  ProcessListItem,
  ProcessSort,
  SoftDeleteWithHistoryInput,
  UpdateProcessWithHistoryInput,
} from '@/domain/entities/process';
import type { Page, PaginationParams } from '@/domain/pagination';

/**
 * Persistência de Process. Todo método de leitura recebe `AccessScope` e o
 * aplica na query (docs/06, seção "Autorização" — esquecer de aplicá-lo é
 * erro de compilação, não bug silencioso de vazamento de dados).
 */
export interface ProcessRepository {
  /** Entidade plana, sem relações — usada para checagens internas (ex.: diff de update). */
  findRawById(id: string, scope: AccessScope): Promise<Process | null>;
  /** Detalhe agregado (docs/05, "GET /processes/:id"). `null` se inexistente ou fora do escopo. */
  findDetailById(id: string, scope: AccessScope): Promise<ProcessDetail | null>;
  list(
    filters: ProcessFilters,
    scope: AccessScope,
    pagination: PaginationParams,
    sort: ProcessSort,
  ): Promise<Page<ProcessListItem>>;
  /** Uma entrada por KanbanStage, com `total` real e até `limitPerStage` itens (docs/05). */
  board(
    filters: ProcessFilters,
    scope: AccessScope,
    limitPerStage: number,
  ): Promise<ProcessBoardStageResult[]>;
  /**
   * Gera o código sequencial (MERGE + OUTPUT), cria o processo e o
   * histórico `PROCESS_CREATED` na mesma transação (docs/04). Em caso de
   * colisão do `code` único, a implementação tenta novamente internamente.
   */
  createWithHistory(input: CreateProcessWithHistoryInput): Promise<ProcessDetail>;
  /** Atualiza campos e grava histórico `PROCESS_UPDATED` com o diff, na mesma transação. */
  updateWithHistory(id: string, input: UpdateProcessWithHistoryInput): Promise<ProcessDetail>;
  /**
   * Move de etapa e grava histórico `STAGE_CHANGED` na mesma transação
   * (docs/12, Tarefa 10 — se a escrita do histórico falhar, a mudança de
   * etapa é desfeita). Atualiza `stageChangedAt` e `completedAt` conforme
   * `toStageIsFinal`.
   */
  moveStageWithHistory(id: string, input: MoveStageWithHistoryInput): Promise<ProcessDetail>;
  /** Define/limpa o responsável e grava histórico `RESPONSIBLE_CHANGED`, na mesma transação. */
  assignResponsibleWithHistory(
    id: string,
    input: AssignResponsibleWithHistoryInput,
  ): Promise<ProcessDetail>;
  /** Exclusão lógica (`deletedAt`/`deletedById`) e histórico `PROCESS_DELETED`, na mesma transação. */
  softDeleteWithHistory(id: string, input: SoftDeleteWithHistoryInput): Promise<void>;
  /** Trilha paginada em ordem cronológica (docs/05, `GET /processes/:id/history`). */
  listHistory(
    id: string,
    scope: AccessScope,
    pagination: PaginationParams,
  ): Promise<Page<ProcessHistoryEntry> | null>;
}
