import { FakeRealtimeProvider } from '../helpers/fakes/fake-realtime-provider';
import { InMemoryKanbanStageRepository } from '../helpers/fakes/in-memory-kanban-stage-repository';

import { ConflictError, NotFoundError, ValidationError } from '@/domain/errors/app-error';
import { KanbanStageService } from '@/services/kanban-stage-service';

function buildContext(): {
  service: KanbanStageService;
  stageRepository: InMemoryKanbanStageRepository;
  realtimeProvider: FakeRealtimeProvider;
} {
  const stageRepository = new InMemoryKanbanStageRepository();
  const realtimeProvider = new FakeRealtimeProvider();
  const service = new KanbanStageService({ stageRepository, realtimeProvider });
  return { service, stageRepository, realtimeProvider };
}

describe('KanbanStageService', () => {
  describe('create', () => {
    it('cria a primeira etapa com order 0', async () => {
      const { service } = buildContext();

      const stage = await service.create({ name: 'Entrada' });

      expect(stage.order).toBe(0);
    });

    it('nova etapa entra sempre no fim da ordem atual', async () => {
      const { service } = buildContext();
      await service.create({ name: 'Entrada' });
      await service.create({ name: 'Em Andamento' });

      const third = await service.create({ name: 'Concluído', isFinal: true });

      expect(third.order).toBe(2);
    });

    it('rejeita nome duplicado com 409 CONFLICT', async () => {
      const { service } = buildContext();
      await service.create({ name: 'Entrada' });

      await expect(service.create({ name: 'Entrada' })).rejects.toBeInstanceOf(ConflictError);
    });

    it('emite stages:changed pós-commit (docs/05)', async () => {
      const { service, realtimeProvider } = buildContext();

      await service.create({ name: 'Entrada' });

      expect(realtimeProvider.stagesChangedCount).toBe(1);
    });
  });

  describe('update', () => {
    it('atualiza campos da etapa', async () => {
      const { service } = buildContext();
      const stage = await service.create({ name: 'Entrada' });

      const updated = await service.update(stage.id, { name: 'Nova Entrada', color: '#ff0000' });

      expect(updated.name).toBe('Nova Entrada');
      expect(updated.color).toBe('#ff0000');
    });

    it('rejeita renomear para um nome já usado por outra etapa', async () => {
      const { service } = buildContext();
      await service.create({ name: 'Entrada' });
      const second = await service.create({ name: 'Em Andamento' });

      await expect(service.update(second.id, { name: 'Entrada' })).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('permite manter o próprio nome sem conflito', async () => {
      const { service } = buildContext();
      const stage = await service.create({ name: 'Entrada' });

      const updated = await service.update(stage.id, { name: 'Entrada', color: '#00ff00' });
      expect(updated.color).toBe('#00ff00');
    });

    it('rejeita etapa inexistente com 404', async () => {
      const { service } = buildContext();

      await expect(service.update('nao-existe', { name: 'X' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('emite stages:changed pós-commit ao atualizar', async () => {
      const { service, realtimeProvider } = buildContext();
      const stage = await service.create({ name: 'Entrada' });
      realtimeProvider.stagesChangedCount = 0;

      await service.update(stage.id, { name: 'Nova Entrada' });

      expect(realtimeProvider.stagesChangedCount).toBe(1);
    });
  });

  describe('delete', () => {
    it('exclui etapa sem processos, quando não é a última', async () => {
      const { service, stageRepository } = buildContext();
      const first = await service.create({ name: 'Entrada' });
      await service.create({ name: 'Em Andamento' });

      await service.delete(first.id);

      expect(stageRepository.items).toHaveLength(1);
    });

    it('bloqueia exclusão de etapa com processos ativos com 409 STAGE_NOT_EMPTY e processCount', async () => {
      const { service, stageRepository } = buildContext();
      const first = await service.create({ name: 'Entrada' });
      await service.create({ name: 'Em Andamento' });
      stageRepository.activeProcessCounts.set(first.id, 5);

      await expect(service.delete(first.id)).rejects.toMatchObject({
        code: 'STAGE_NOT_EMPTY',
        status: 409,
        details: { processCount: 5 },
      });
    });

    it('bloqueia exclusão da última etapa restante com 409 CONFLICT', async () => {
      const { service } = buildContext();
      const only = await service.create({ name: 'Única' });

      await expect(service.delete(only.id)).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
    });

    it('emite stages:changed pós-commit ao excluir', async () => {
      const { service, realtimeProvider } = buildContext();
      const first = await service.create({ name: 'Entrada' });
      await service.create({ name: 'Em Andamento' });
      realtimeProvider.stagesChangedCount = 0;

      await service.delete(first.id);

      expect(realtimeProvider.stagesChangedCount).toBe(1);
    });
  });

  describe('reorder', () => {
    it('persiste a nova ordem pelo índice da lista recebida', async () => {
      const { service } = buildContext();
      const first = await service.create({ name: 'Entrada' });
      const second = await service.create({ name: 'Em Andamento' });
      const third = await service.create({ name: 'Concluído' });

      const reordered = await service.reorder([third.id, first.id, second.id]);

      expect(reordered.map((stage) => stage.id)).toEqual([third.id, first.id, second.id]);
      expect(reordered.map((stage) => stage.order)).toEqual([0, 1, 2]);
    });

    it('rejeita lista com ids faltando com ValidationError', async () => {
      const { service } = buildContext();
      const first = await service.create({ name: 'Entrada' });
      await service.create({ name: 'Em Andamento' });

      await expect(service.reorder([first.id])).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita lista com ids duplicados com ValidationError', async () => {
      const { service } = buildContext();
      const first = await service.create({ name: 'Entrada' });
      const second = await service.create({ name: 'Em Andamento' });

      await expect(service.reorder([first.id, first.id, second.id])).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejeita lista com id inexistente com ValidationError', async () => {
      const { service } = buildContext();
      const first = await service.create({ name: 'Entrada' });
      const second = await service.create({ name: 'Em Andamento' });

      await expect(service.reorder([first.id, second.id, 'nao-existe'])).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('emite stages:changed pós-commit ao reordenar', async () => {
      const { service, realtimeProvider } = buildContext();
      const first = await service.create({ name: 'Entrada' });
      const second = await service.create({ name: 'Em Andamento' });
      realtimeProvider.stagesChangedCount = 0;

      await service.reorder([second.id, first.id]);

      expect(realtimeProvider.stagesChangedCount).toBe(1);
    });
  });

  describe('listWithCounts', () => {
    it('inclui processCount por etapa no escopo informado', async () => {
      const { service, stageRepository } = buildContext();
      const first = await service.create({ name: 'Entrada' });
      const second = await service.create({ name: 'Em Andamento' });
      stageRepository.activeProcessCounts.set(first.id, 2);
      stageRepository.activeProcessCounts.set(second.id, 0);

      const stages = await service.listWithCounts({ kind: 'ALL' });

      expect(stages.find((stage) => stage.id === first.id)?.processCount).toBe(2);
      expect(stages.find((stage) => stage.id === second.id)?.processCount).toBe(0);
    });
  });
});
