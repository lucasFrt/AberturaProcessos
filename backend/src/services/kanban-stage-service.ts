import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  CreateKanbanStageData,
  KanbanStage,
  UpdateKanbanStageData,
} from '@/domain/entities/kanban-stage';
import { ConflictError, NotFoundError, ValidationError } from '@/domain/errors/app-error';
import type { RealtimeProvider } from '@/domain/realtime/realtime-provider';
import type {
  KanbanStageRepository,
  KanbanStageWithCount,
} from '@/domain/repositories/kanban-stage-repository';

export interface KanbanStageServiceDeps {
  stageRepository: KanbanStageRepository;
  /** Opcional pelo mesmo motivo de `QueueProvider` (docs/07) — ver process-service.ts. */
  realtimeProvider?: RealtimeProvider | undefined;
}

/**
 * CRUD de KanbanStage, listagem com contagem e reordenação atômica
 * (RF-30 a RF-33; docs/05 seção "Etapas do Kanban", docs/04
 * "Reordenação de etapas" e "Regras de exclusão"). Escrita restrita a
 * ADMIN — aplicado pelo `authorize('ADMIN')` na rota, não aqui.
 */
export class KanbanStageService {
  constructor(private readonly deps: KanbanStageServiceDeps) {}

  async list(): Promise<KanbanStage[]> {
    return this.deps.stageRepository.list();
  }

  async listWithCounts(scope: AccessScope): Promise<KanbanStageWithCount[]> {
    return this.deps.stageRepository.listWithCounts(scope);
  }

  async findById(id: string): Promise<KanbanStage> {
    const stage = await this.deps.stageRepository.findById(id);
    if (!stage) {
      throw new NotFoundError('NOT_FOUND', 'Etapa não encontrada.');
    }
    return stage;
  }

  /** Nova etapa sempre entra no fim da ordem atual (docs/05, docs/12 critério de aceite). */
  async create(data: CreateKanbanStageData): Promise<KanbanStage> {
    const existing = await this.deps.stageRepository.findByName(data.name);
    if (existing) {
      throw new ConflictError('CONFLICT', 'Já existe uma etapa com este nome.');
    }

    const maxOrder = await this.deps.stageRepository.findMaxOrder();
    const order = maxOrder === null ? 0 : maxOrder + 1;

    const stage = await this.deps.stageRepository.create({ ...data, order });

    // Emissão pós-commit (docs/07): qualquer escrita em /stages emite stages:changed (docs/05).
    this.deps.realtimeProvider?.emitStagesChanged();

    return stage;
  }

  async update(id: string, data: UpdateKanbanStageData): Promise<KanbanStage> {
    await this.findById(id);

    if (data.name !== undefined) {
      const existing = await this.deps.stageRepository.findByName(data.name);
      if (existing && existing.id !== id) {
        throw new ConflictError('CONFLICT', 'Já existe uma etapa com este nome.');
      }
    }

    const stage = await this.deps.stageRepository.update(id, data);

    this.deps.realtimeProvider?.emitStagesChanged();

    return stage;
  }

  /**
   * Bloqueia exclusão de etapa com processos ativos (`409 STAGE_NOT_EMPTY`
   * com `processCount`) e da última etapa restante (`409 CONFLICT`) —
   * docs/05, docs/12 critério de aceite da Tarefa 8.
   */
  async delete(id: string): Promise<void> {
    await this.findById(id);

    const total = await this.deps.stageRepository.count();
    if (total <= 1) {
      throw new ConflictError('CONFLICT', 'Não é possível excluir a última etapa restante.');
    }

    const processCount = await this.deps.stageRepository.countActiveProcesses(id);
    if (processCount > 0) {
      throw new ConflictError(
        'STAGE_NOT_EMPTY',
        'Não é possível excluir uma etapa que ainda contém processos ativos.',
        { processCount },
      );
    }

    await this.deps.stageRepository.delete(id);

    this.deps.realtimeProvider?.emitStagesChanged();
  }

  /**
   * Persiste `order = índice` pela lista recebida (docs/04). A lista
   * precisa conter exatamente os ids de todas as etapas existentes —
   * caso contrário, é impossível determinar a posição das que faltarem.
   */
  async reorder(stageIds: string[]): Promise<KanbanStage[]> {
    const uniqueIds = new Set(stageIds);
    if (uniqueIds.size !== stageIds.length) {
      throw new ValidationError('A lista de ids não pode conter duplicados.');
    }

    const currentStages = await this.deps.stageRepository.list();
    const currentIds = new Set(currentStages.map((stage) => stage.id));

    if (uniqueIds.size !== currentIds.size || ![...uniqueIds].every((id) => currentIds.has(id))) {
      throw new ValidationError('A lista precisa conter todos os ids de etapas existentes.');
    }

    const stages = await this.deps.stageRepository.reorder(stageIds);

    this.deps.realtimeProvider?.emitStagesChanged();

    return stages;
  }
}
