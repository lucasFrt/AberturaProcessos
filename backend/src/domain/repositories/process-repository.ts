import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  AssignResponsibleWithHistoryInput,
  CreateProcessWithHistoryInput,
  IlogLink,
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
  /**
   * Processos ativos cujo `code` OU `reference` é exatamente `ref`
   * (comparação sem distinção de maiúsculas). Usado pelo intake para
   * resolver "Processo 123123" citado num e-mail (docs/13, decisão 6).
   * Escopo é sempre ALL: o intake é interno (OPERATIONAL/ADMIN).
   */
  findExactByRef(ref: string): Promise<ProcessListItem[]>;
  /** Processo ativo vinculado a este `processoid` do iLog (docs/15). Escopo ALL: uso interno do espelho. */
  findByIlogProcessId(ilogProcessId: number): Promise<Process | null>;
  /** Itens de listagem por id, sem escopo (uso interno do intake/espelho). Ignora excluídos. */
  findListItemsByIds(ids: string[]): Promise<ProcessListItem[]>;
  /**
   * Grava/atualiza o vínculo com o iLog (docs/15) sem histórico — o espelho
   * roda a cada 5 minutos e "lido de novo" não é evento para a timeline.
   */
  linkIlog(id: string, link: IlogLink): Promise<void>;
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
