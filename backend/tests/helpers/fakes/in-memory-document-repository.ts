import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  CreateDocumentWithHistoryInput,
  Document,
  DocumentWithUploader,
  SoftDeleteDocumentWithHistoryInput,
} from '@/domain/entities/document';
import type { DocumentRepository } from '@/domain/repositories/document-repository';

let idCounter = 0;

interface FakeUser {
  id: string;
  name: string;
}

interface FakeProcess {
  id: string;
  clientCompanyId: string;
  requestingCompanyId: string | null;
  deletedAt: Date | null;
}

/** Fake em memória de DocumentRepository (docs/09, `tests/unit` com fakes). */
export class InMemoryDocumentRepository implements DocumentRepository {
  readonly items: Document[] = [];
  readonly users: FakeUser[] = [];
  readonly processes: FakeProcess[] = [];
  readonly historyEntries: { processId: string; action: string; description: string }[] = [];

  private scopeMatches(process: FakeProcess, scope: AccessScope): boolean {
    if (scope.kind === 'ALL') return true;
    return (
      scope.companyIds.includes(process.clientCompanyId) ||
      (process.requestingCompanyId !== null &&
        scope.companyIds.includes(process.requestingCompanyId))
    );
  }

  private withUploader(doc: Document): DocumentWithUploader {
    const user = this.users.find((u) => u.id === doc.uploadedById);
    return { ...doc, uploadedBy: user ?? { id: doc.uploadedById, name: 'Usuário desconhecido' } };
  }

  async listByProcess(
    processId: string,
    scope: AccessScope,
  ): Promise<DocumentWithUploader[] | null> {
    const process = this.processes.find((p) => p.id === processId && p.deletedAt === null);
    if (!process || !this.scopeMatches(process, scope)) return null;

    return this.items
      .filter((item) => item.processId === processId && item.deletedAt === null)
      .map((item) => this.withUploader(item));
  }

  async findDetailById(id: string, scope: AccessScope): Promise<DocumentWithUploader | null> {
    const doc = this.items.find((item) => item.id === id && item.deletedAt === null);
    if (!doc) return null;
    const process = this.processes.find((p) => p.id === doc.processId);
    if (!process || !this.scopeMatches(process, scope)) return null;
    return this.withUploader(doc);
  }

  async createManyWithHistory(
    input: CreateDocumentWithHistoryInput,
  ): Promise<DocumentWithUploader[]> {
    const created: DocumentWithUploader[] = [];
    for (const doc of input.documents) {
      idCounter += 1;
      const record: Document = {
        id: `document-${idCounter}`,
        processId: doc.processId,
        originalName: doc.originalName,
        storedName: doc.storedName,
        relativePath: doc.relativePath,
        mimeType: doc.mimeType,
        size: doc.size,
        sha256: doc.sha256,
        uploadedById: doc.uploadedById,
        source: doc.source,
        receivedAt: doc.receivedAt,
        deletedAt: null,
        deletedById: null,
        createdAt: new Date(),
      };
      this.items.push(record);
      this.historyEntries.push({
        processId: doc.processId,
        action: 'DOCUMENT_ADDED',
        description: `Documento ${doc.originalName} anexado.`,
      });
      created.push(this.withUploader(record));
    }
    return created;
  }

  async softDeleteWithHistory(
    id: string,
    input: SoftDeleteDocumentWithHistoryInput,
  ): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`Document ${id} não encontrado no fake.`);
    const current = this.items[index];
    if (!current) throw new Error(`Document ${id} não encontrado no fake.`);

    this.items[index] = { ...current, deletedAt: new Date(), deletedById: input.actorId };
    this.historyEntries.push({
      processId: input.processId,
      action: 'DOCUMENT_REMOVED',
      description: input.description,
    });
  }
}
