import type {
  ProcessIdentifier,
  ProcessIdentifierInput,
  ProcessIdentifierMatch,
} from '@/domain/entities/process-identifier';
import type { ProcessIdentifierSource } from '@/domain/enums';

/**
 * Índice de identificadores (docs/15, seção 5.1). Sem `AccessScope`: quem
 * consulta é o intake (interno) e o sync; a leitura por processo na API
 * passa pelo `ProcessRepository`, que aplica o escopo antes.
 */
export interface ProcessIdentifierRepository {
  listByProcess(processId: string): Promise<ProcessIdentifier[]>;
  /**
   * Processos ativos (não excluídos) que têm algum identificador com um
   * desses `normalized`. Uma linha por (processo, identificador) casado.
   */
  findByNormalized(normalized: string[]): Promise<ProcessIdentifierMatch[]>;
  /** Acrescenta sem duplicar (`(processId, kind, normalized)` único); devolve quantos entraram. */
  addForProcess(
    processId: string,
    source: ProcessIdentifierSource,
    identifiers: ProcessIdentifierInput[],
  ): Promise<number>;
  /**
   * Substitui os identificadores de uma `source` (o espelho regrava os
   * `ILOG` a cada leitura); os das outras fontes ficam.
   */
  replaceForProcess(
    processId: string,
    source: ProcessIdentifierSource,
    identifiers: ProcessIdentifierInput[],
  ): Promise<void>;
}
