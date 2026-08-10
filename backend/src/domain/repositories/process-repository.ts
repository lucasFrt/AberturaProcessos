import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  CreateProcessWithHistoryInput,
  Process,
  ProcessBoardStageResult,
  ProcessDetail,
  ProcessFilters,
  ProcessListItem,
  ProcessSort,
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
}
