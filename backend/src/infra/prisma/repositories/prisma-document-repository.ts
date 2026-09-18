import type { Prisma, PrismaClient } from '@prisma/client';

import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  CreateDocumentWithHistoryInput,
  DocumentWithUploader,
  SoftDeleteDocumentWithHistoryInput,
} from '@/domain/entities/document';
import type { RecordSource } from '@/domain/enums';
import type { DocumentRepository } from '@/domain/repositories/document-repository';

const WITH_UPLOADER_INCLUDE = {
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.DocumentInclude;

type DocumentRow = Prisma.DocumentGetPayload<{ include: typeof WITH_UPLOADER_INCLUDE }>;

function mapDocument(row: DocumentRow): DocumentWithUploader {
  return {
    id: row.id,
    processId: row.processId,
    originalName: row.originalName,
    storedName: row.storedName,
    relativePath: row.relativePath,
    mimeType: row.mimeType,
    size: row.size,
    sha256: row.sha256,
    uploadedById: row.uploadedById,
    source: row.source as RecordSource,
    receivedAt: row.receivedAt,
    deletedAt: row.deletedAt,
    deletedById: row.deletedById,
    createdAt: row.createdAt,
    uploadedBy: { id: row.uploadedBy.id, name: row.uploadedBy.name },
  };
}

/** Escopo por recurso (docs/06): mesma regra do Process pai (cliente ou solicitante). */
function scopeWhere(scope: AccessScope): Prisma.ProcessWhereInput {
  if (scope.kind === 'ALL') return {};
  return {
    OR: [
      { clientCompanyId: { in: scope.companyIds } },
      { requestingCompanyId: { in: scope.companyIds } },
    ],
  };
}

export class PrismaDocumentRepository implements DocumentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByProcess(
    processId: string,
    scope: AccessScope,
  ): Promise<DocumentWithUploader[] | null> {
    const process = await this.prisma.process.findFirst({
      where: { id: processId, deletedAt: null, ...scopeWhere(scope) },
      select: { id: true },
    });
    if (!process) return null;

    const rows = await this.prisma.document.findMany({
      where: { processId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: WITH_UPLOADER_INCLUDE,
    });

    return rows.map(mapDocument);
  }

  async findDetailById(id: string, scope: AccessScope): Promise<DocumentWithUploader | null> {
    const row = await this.prisma.document.findFirst({
      where: { id, deletedAt: null, process: { deletedAt: null, ...scopeWhere(scope) } },
      include: WITH_UPLOADER_INCLUDE,
    });
    return row ? mapDocument(row) : null;
  }

  async createManyWithHistory(
    input: CreateDocumentWithHistoryInput,
  ): Promise<DocumentWithUploader[]> {
    const createdIds = await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];

      // Uma escrita de Document + um histórico DOCUMENT_ADDED por arquivo,
      // na mesma transação (docs/05, docs/12 Tarefa 11).
      for (const doc of input.documents) {
        const created = await tx.document.create({
          data: {
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
          },
        });
        ids.push(created.id);

        await tx.processHistory.create({
          data: {
            processId: doc.processId,
            action: 'DOCUMENT_ADDED',
            actorId: input.actorId,
            description: `Documento ${doc.originalName} anexado.`,
          },
        });
      }

      return ids;
    });

    const rows = await this.prisma.document.findMany({
      where: { id: { in: createdIds } },
      include: WITH_UPLOADER_INCLUDE,
    });
    // Preserva a ordem de criação (findMany com `in` não garante ordem).
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered: DocumentWithUploader[] = [];
    for (const id of createdIds) {
      const row = byId.get(id);
      if (row) ordered.push(mapDocument(row));
    }
    return ordered;
  }

  async softDeleteWithHistory(
    id: string,
    input: SoftDeleteDocumentWithHistoryInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: input.actorId },
      });

      await tx.processHistory.create({
        data: {
          processId: input.processId,
          action: 'DOCUMENT_REMOVED',
          actorId: input.actorId,
          description: input.description,
        },
      });
    });
  }
}
