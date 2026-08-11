import { FakeRealtimeProvider } from '../helpers/fakes/fake-realtime-provider';
import { FakeStorageProvider } from '../helpers/fakes/fake-storage-provider';
import { InMemoryDocumentRepository } from '../helpers/fakes/in-memory-document-repository';
import { InMemoryProcessRepository } from '../helpers/fakes/in-memory-process-repository';

import type { AccessScope } from '@/domain/entities/access-scope';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/errors/app-error';
import { DocumentService } from '@/services/document-service';

const ALL_SCOPE: AccessScope = { kind: 'ALL' };

function buildContext(maxFilesPerRequest = 10): {
  service: DocumentService;
  documentRepository: InMemoryDocumentRepository;
  processRepository: InMemoryProcessRepository;
  storageProvider: FakeStorageProvider;
  realtimeProvider: FakeRealtimeProvider;
} {
  const documentRepository = new InMemoryDocumentRepository();
  const processRepository = new InMemoryProcessRepository();
  const storageProvider = new FakeStorageProvider();
  const realtimeProvider = new FakeRealtimeProvider();
  const service = new DocumentService({
    documentRepository,
    processRepository,
    storageProvider,
    maxFilesPerRequest,
    realtimeProvider,
  });
  return { service, documentRepository, processRepository, storageProvider, realtimeProvider };
}

function pushProcess(
  processRepository: InMemoryProcessRepository,
  documentRepository: InMemoryDocumentRepository,
  id: string,
  clientCompanyId: string,
): void {
  const now = new Date();
  processRepository.items.push({
    id,
    code: `PRC-2026-${id}`,
    reference: 'Referência',
    additionalInfo: null,
    clientCompanyId,
    requestingCompanyId: null,
    currentStageId: 'stage-1',
    responsibleId: null,
    createdById: 'user-1',
    stageChangedAt: now,
    completedAt: null,
    deletedAt: null,
    deletedById: null,
    createdAt: now,
    updatedAt: now,
  });
  documentRepository.processes.push({
    id,
    clientCompanyId,
    requestingCompanyId: null,
    deletedAt: null,
  });
}

describe('DocumentService', () => {
  describe('upload', () => {
    it('faz upload de arquivo sem extensão conhecida e grava DOCUMENT_ADDED no histórico', async () => {
      const { service, processRepository, documentRepository } = buildContext();
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');
      documentRepository.users.push({ id: 'user-1', name: 'Maria' });

      const documents = await service.upload('process-1', 'user-1', ALL_SCOPE, [
        {
          originalName: 'arquivo-sem-extensao',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from('conteudo'),
        },
      ]);

      expect(documents).toHaveLength(1);
      expect(documents[0]?.originalName).toBe('arquivo-sem-extensao');
      expect(
        documentRepository.historyEntries.some((entry) => entry.action === 'DOCUMENT_ADDED'),
      ).toBe(true);
    });

    it('grava sha256 calculado a partir do conteúdo', async () => {
      const { service, processRepository, documentRepository, storageProvider } = buildContext();
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');
      documentRepository.users.push({ id: 'user-1', name: 'Maria' });

      const [doc] = await service.upload('process-1', 'user-1', ALL_SCOPE, [
        { originalName: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('bytes') },
      ]);

      expect(doc?.sha256).toHaveLength(64);
      expect(storageProvider.savedFiles.size).toBe(1);
    });

    it('rejeita processo fora do escopo com 404', async () => {
      const { service, processRepository, documentRepository } = buildContext();
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');

      const otherScope: AccessScope = { kind: 'COMPANIES', companyIds: ['outra-empresa'] };

      await expect(
        service.upload('process-1', 'user-1', otherScope, [
          { originalName: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') },
        ]),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejeita upload sem arquivos', async () => {
      const { service, processRepository, documentRepository } = buildContext();
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');

      await expect(service.upload('process-1', 'user-1', ALL_SCOPE, [])).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('emite process:updated pós-commit ao fazer upload (docs/05)', async () => {
      const { service, processRepository, documentRepository, realtimeProvider } = buildContext();
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');
      documentRepository.users.push({ id: 'user-1', name: 'Maria' });

      await service.upload('process-1', 'user-1', ALL_SCOPE, [
        { originalName: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') },
      ]);

      expect(realtimeProvider.processEvents).toHaveLength(1);
      const emitted = realtimeProvider.processEvents[0];
      expect(emitted?.event.name).toBe('process:updated');
      if (emitted?.event.name === 'process:updated') {
        expect(emitted.event.payload.processId).toBe('process-1');
      }
      expect(emitted?.target).toEqual({ clientCompanyId: 'company-1', requestingCompanyId: null });
    });

    it('rejeita quando excede MAX_FILES_PER_REQUEST', async () => {
      const { service, processRepository, documentRepository } = buildContext(1);
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');

      await expect(
        service.upload('process-1', 'user-1', ALL_SCOPE, [
          { originalName: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') },
          { originalName: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('y') },
        ]),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('download', () => {
    it('devolve bytes idênticos e o documento com nome original', async () => {
      const { service, processRepository, documentRepository } = buildContext();
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');
      documentRepository.users.push({ id: 'user-1', name: 'Maria' });

      const content = Buffer.from('conteúdo com acentuação');
      const [uploaded] = await service.upload('process-1', 'user-1', ALL_SCOPE, [
        { originalName: 'relatório final.pdf', mimeType: 'application/pdf', buffer: content },
      ]);

      const { document, content: downloaded } = await service.download(uploaded!.id, ALL_SCOPE);

      expect(document.originalName).toBe('relatório final.pdf');
      expect(downloaded.equals(content)).toBe(true);
    });

    it('CLIENT de outra organização recebe 404 no download', async () => {
      const { service, processRepository, documentRepository } = buildContext();
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');
      documentRepository.users.push({ id: 'user-1', name: 'Maria' });

      const [uploaded] = await service.upload('process-1', 'user-1', ALL_SCOPE, [
        { originalName: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') },
      ]);

      const otherScope: AccessScope = { kind: 'COMPANIES', companyIds: ['outra-empresa'] };

      await expect(service.download(uploaded!.id, otherScope)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('softDelete', () => {
    it('CLIENT só exclui documento que ele mesmo enviou', async () => {
      const { service, processRepository, documentRepository } = buildContext();
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');
      documentRepository.users.push({ id: 'client-a', name: 'Cliente A' });
      documentRepository.users.push({ id: 'operational-1', name: 'Operacional' });

      const scope: AccessScope = { kind: 'COMPANIES', companyIds: ['company-1'] };

      const [uploadedByOperational] = await service.upload(
        'process-1',
        'operational-1',
        ALL_SCOPE,
        [{ originalName: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') }],
      );

      await expect(
        service.softDelete(uploadedByOperational!.id, 'client-a', 'CLIENT', scope),
      ).rejects.toBeInstanceOf(ForbiddenError);

      const [uploadedByClientA] = await service.upload('process-1', 'client-a', ALL_SCOPE, [
        { originalName: 'doc2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('y') },
      ]);

      await expect(
        service.softDelete(uploadedByClientA!.id, 'client-a', 'CLIENT', scope),
      ).resolves.toBeUndefined();
    });

    it('OPERATIONAL e ADMIN excluem qualquer documento e gravam DOCUMENT_REMOVED', async () => {
      const { service, processRepository, documentRepository } = buildContext();
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');
      documentRepository.users.push({ id: 'client-a', name: 'Cliente A' });

      const [uploaded] = await service.upload('process-1', 'client-a', ALL_SCOPE, [
        { originalName: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') },
      ]);

      await service.softDelete(uploaded!.id, 'operational-1', 'OPERATIONAL', ALL_SCOPE);

      expect(
        documentRepository.historyEntries.some((entry) => entry.action === 'DOCUMENT_REMOVED'),
      ).toBe(true);
      await expect(service.download(uploaded!.id, ALL_SCOPE)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('documento inexistente ou fora do escopo responde 404', async () => {
      const { service } = buildContext();

      await expect(
        service.softDelete('nao-existe', 'user-1', 'ADMIN', ALL_SCOPE),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('emite process:updated pós-commit ao excluir documento (docs/05)', async () => {
      const { service, processRepository, documentRepository, realtimeProvider } = buildContext();
      pushProcess(processRepository, documentRepository, 'process-1', 'company-1');
      documentRepository.users.push({ id: 'client-a', name: 'Cliente A' });

      const [uploaded] = await service.upload('process-1', 'client-a', ALL_SCOPE, [
        { originalName: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') },
      ]);
      realtimeProvider.processEvents.length = 0; // limpa o evento do upload

      await service.softDelete(uploaded!.id, 'operational-1', 'OPERATIONAL', ALL_SCOPE);

      expect(realtimeProvider.processEvents).toHaveLength(1);
      expect(realtimeProvider.processEvents[0]?.event.name).toBe('process:updated');
    });
  });
});
