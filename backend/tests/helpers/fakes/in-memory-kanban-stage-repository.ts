import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  CreateKanbanStageData,
  KanbanStage,
  UpdateKanbanStageData,
} from '@/domain/entities/kanban-stage';
import type {
  KanbanStageRepository,
  KanbanStageWithCount,
} from '@/domain/repositories/kanban-stage-repository';

let idCounter = 0;

export class InMemoryKanbanStageRepository implements KanbanStageRepository {
  readonly items: KanbanStage[] = [];
  /** stageId -> contagem simulada de processos ativos. */
  readonly activeProcessCounts = new Map<string, number>();

  private sorted(): KanbanStage[] {
    return [...this.items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<KanbanStage | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async findByName(name: string): Promise<KanbanStage | null> {
    return this.items.find((item) => item.name === name) ?? null;
  }

  async list(): Promise<KanbanStage[]> {
    return this.sorted();
  }

  async listWithCounts(scope: AccessScope): Promise<KanbanStageWithCount[]> {
    // O fake não simula processos reais — `activeProcessCounts` já é o
    // resultado esperado após aplicar o escopo, então `scope` é ignorado
    // aqui (mantido na assinatura para compatibilidade com a interface).
    void scope;
    return this.sorted().map((stage) => ({
      ...stage,
      processCount: this.activeProcessCounts.get(stage.id) ?? 0,
    }));
  }

  async findMaxOrder(): Promise<number | null> {
    if (this.items.length === 0) return null;
    return Math.max(...this.items.map((item) => item.order));
  }

  async create(data: CreateKanbanStageData & { order: number }): Promise<KanbanStage> {
    idCounter += 1;
    const now = new Date();
    const stage: KanbanStage = {
      id: `stage-${idCounter}`,
      name: data.name,
      color: data.color ?? '#1677ff',
      order: data.order,
      isFinal: data.isFinal ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(stage);
    return stage;
  }

  async update(id: string, data: UpdateKanbanStageData): Promise<KanbanStage> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`KanbanStage ${id} não encontrada no fake.`);
    const current = this.items[index];
    if (!current) throw new Error(`KanbanStage ${id} não encontrada no fake.`);

    const updated: KanbanStage = {
      ...current,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.isFinal !== undefined ? { isFinal: data.isFinal } : {}),
      updatedAt: new Date(),
    };
    this.items[index] = updated;
    return updated;
  }

  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index !== -1) this.items.splice(index, 1);
  }

  async count(): Promise<number> {
    return this.items.length;
  }

  async countActiveProcesses(stageId: string): Promise<number> {
    return this.activeProcessCounts.get(stageId) ?? 0;
  }

  async reorder(stageIds: string[]): Promise<KanbanStage[]> {
    stageIds.forEach((id, index) => {
      const item = this.items.find((stage) => stage.id === id);
      if (item) item.order = index;
    });
    return this.sorted();
  }
}
