import type { AccessScope } from '@/domain/entities/access-scope';
import type { CreateDocumentData, DocumentWithUploader } from '@/domain/entities/document';
import type { Role } from '@/domain/enums';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/errors/app-error';
import type { DocumentRepository } from '@/domain/repositories/document-repository';
import type { ProcessRepository } from '@/domain/repositories/process-repository';
import type { SavedFile, StorageProvider } from '@/domain/storage/storage-provider';

export interface DocumentServiceDeps {
  documentRepository: DocumentRepository;
  processRepository: ProcessRepository;
  storageProvider: StorageProvider;
  maxFilesPerRequest: number;
}

export interface UploadFileInput {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

/**
 * Upload múltiplo, listagem, download e exclusão lógica de documentos
 * (RF-40 a RF-44; docs/05 seção "Documentos"; docs/12 Tarefa 11). A
 * gravação em disco é delegada a `StorageProvider` — este service nunca
 * toca em `fs` diretamente, apenas orquestra: valida escopo/limites,
 * grava bytes, persiste metadados e histórico.
 */
export class DocumentService {
  constructor(private readonly deps: DocumentServiceDeps) {}

  /**
   * `null` do repositório de processo (fora do escopo ou inexistente)
   * sempre responde 404, nunca 403 (RNF-01; docs/05).
   */
  async upload(
    processId: string,
    actorId: string,
    scope: AccessScope,
    files: UploadFileInput[],
  ): Promise<DocumentWithUploader[]> {
    const process = await this.deps.processRepository.findRawById(processId, scope);
    if (!process) {
      throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
    }

    if (files.length === 0) {
      throw new ValidationError('Envie ao menos um arquivo.');
    }
    if (files.length > this.deps.maxFilesPerRequest) {
      throw new ValidationError(
        `Limite de ${this.deps.maxFilesPerRequest} arquivos por requisição excedido.`,
      );
    }

    const savedFiles: { saved: SavedFile; file: UploadFileInput }[] = [];
    for (const file of files) {
      const saved = await this.deps.storageProvider.saveFile({
        processId,
        originalName: file.originalName,
        buffer: file.buffer,
      });
      savedFiles.push({ saved, file });
    }

    const documents: CreateDocumentData[] = savedFiles.map(({ saved, file }) => ({
      processId,
      originalName: file.originalName,
      storedName: saved.storedName,
      relativePath: saved.relativePath,
      mimeType: file.mimeType,
      size: saved.size,
      sha256: saved.sha256,
      uploadedById: actorId,
    }));

    return this.deps.documentRepository.createManyWithHistory({
      processId,
      documents,
      actorId,
    });
  }

  async listByProcess(processId: string, scope: AccessScope): Promise<DocumentWithUploader[]> {
    const documents = await this.deps.documentRepository.listByProcess(processId, scope);
    if (!documents) {
      throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
    }
    return documents;
  }

  /** Bytes + metadados para a rota de download (docs/05, `GET /documents/:id/download`). */
  async download(
    id: string,
    scope: AccessScope,
  ): Promise<{ document: DocumentWithUploader; content: Buffer }> {
    const document = await this.deps.documentRepository.findDetailById(id, scope);
    if (!document) {
      throw new NotFoundError('NOT_FOUND', 'Documento não encontrado.');
    }

    const content = await this.deps.storageProvider.readFile(document.relativePath);
    return { document, content };
  }

  /**
   * Exclusão lógica (RF-43). CLIENT só pode excluir o que ele mesmo
   * enviou; OPERATIONAL/ADMIN excluem qualquer um (docs/02, matriz de
   * permissões; docs/05, `DELETE /documents/:id`).
   */
  async softDelete(
    id: string,
    actorId: string,
    actorRole: Role,
    scope: AccessScope,
  ): Promise<void> {
    const document = await this.deps.documentRepository.findDetailById(id, scope);
    if (!document) {
      throw new NotFoundError('NOT_FOUND', 'Documento não encontrado.');
    }

    if (actorRole === 'CLIENT' && document.uploadedById !== actorId) {
      throw new ForbiddenError(
        'FORBIDDEN',
        'Você só pode excluir os documentos que você mesmo enviou.',
      );
    }

    await this.deps.documentRepository.softDeleteWithHistory(id, {
      processId: document.processId,
      actorId,
      description: `Documento ${document.originalName} removido.`,
    });
  }
}
