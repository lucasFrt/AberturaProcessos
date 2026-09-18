import type {
  CreateIntakeEventData,
  IntakeEvent,
  IntakeEventFilters,
  UpdateIntakeEventData,
} from '@/domain/entities/intake-event';
import type { IntakeChannel } from '@/domain/enums';
import type { Page, PaginationParams } from '@/domain/pagination';
import type {
  ClaimOutcome,
  IntakeEventRepository,
} from '@/domain/repositories/intake-event-repository';

let idCounter = 0;

/** Fake em memória de IntakeEventRepository (docs/09). Reproduz a unicidade de (channel, externalId). */
export class InMemoryIntakeEventRepository implements IntakeEventRepository {
  readonly items: IntakeEvent[] = [];

  async claim(data: CreateIntakeEventData): Promise<ClaimOutcome> {
    const existing = await this.findByExternalId(data.channel, data.externalId);
    if (existing) return { created: false, existing };

    idCounter += 1;
    const now = new Date();
    const event: IntakeEvent = {
      id: `intake-${idCounter}`,
      processId: null,
      result: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.items.push(event);
    return { created: true, event };
  }

  async findById(id: string): Promise<IntakeEvent | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async findByExternalId(channel: IntakeChannel, externalId: string): Promise<IntakeEvent | null> {
    return (
      this.items.find((item) => item.channel === channel && item.externalId === externalId) ?? null
    );
  }

  async update(id: string, data: UpdateIntakeEventData): Promise<IntakeEvent> {
    const event = this.items.find((item) => item.id === id);
    if (!event) throw new Error(`Fake: evento ${id} não existe.`);
    if (data.status !== undefined) event.status = data.status;
    if (data.processId !== undefined) event.processId = data.processId;
    if (data.result !== undefined) event.result = data.result;
    if (data.errorMessage !== undefined) event.errorMessage = data.errorMessage;
    event.updatedAt = new Date();
    return event;
  }

  async list(
    filters: IntakeEventFilters,
    pagination: PaginationParams,
  ): Promise<Page<IntakeEvent>> {
    const filtered = this.items.filter((item) => {
      if (filters.externalId && item.externalId !== filters.externalId) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.processId && item.processId !== filters.processId) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (pagination.page - 1) * pagination.pageSize;
    return { items: sorted.slice(start, start + pagination.pageSize), total: sorted.length };
  }
}
