import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  CreateDocumentWithHistoryInput,
  DocumentWithUploader,
  SoftDeleteDocumentWithHistoryInput,
} from '@/domain/entities/document';

/**
 * Persistência de Document (docs/05 seção "Documentos"; RF-40 a RF-44).
 * O escopo de acesso é o do processo pai — todo método que expõe dados a
 * um usuário aplica `AccessScope` via join com `Process` (RNF-01).
 */
export interface DocumentRepository {
  /** `null` se o processo não existe ou está fora do escopo (docs/05, 404 antes de 403). */
  listByProcess(processId: string, scope: AccessScope): Promise<DocumentWithUploader[] | null>;
  /** Documento ativo (não excluído) cujo processo está no escopo. `null` caso contrário. */
  findDetailById(id: string, scope: AccessScope): Promise<DocumentWithUploader | null>;
  /** Um `Document` por arquivo e um histórico `DOCUMENT_ADDED` por arquivo, na mesma transação. */
  createManyWithHistory(input: CreateDocumentWithHistoryInput): Promise<DocumentWithUploader[]>;
  /** Exclusão lógica e histórico `DOCUMENT_REMOVED`, na mesma transação. */
  softDeleteWithHistory(id: string, input: SoftDeleteDocumentWithHistoryInput): Promise<void>;
}
