import type {
  CreateIntakeEventData,
  IntakeEvent,
  IntakeEventFilters,
  UpdateIntakeEventData,
} from '@/domain/entities/intake-event';
import type { IntakeChannel, IntakeEventStatus } from '@/domain/enums';
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
    if (data.internetMessageId) {
      const byMessageId = await this.findByInternetMessageId(data.channel, data.internetMessageId);
      if (byMessageId) return { created: false, existing: byMessageId };
    }
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

  async findByInternetMessageId(
    channel: IntakeChannel,
    internetMessageId: string,
  ): Promise<IntakeEvent | null> {
    return (
      this.items.find(
        (item) => item.channel === channel && item.internetMessageId === internetMessageId,
      ) ?? null
    );
  }

  async findByMessages(
    channel: IntakeChannel,
    externalIds: readonly string[],
    internetMessageIds: readonly string[],
  ): Promise<IntakeEvent[]> {
    return this.items.filter(
      (item) =>
        item.channel === channel &&
        (externalIds.includes(item.externalId) ||
          (item.internetMessageId !== null && internetMessageIds.includes(item.internetMessageId))),
    );
  }

  async update(id: string, data: UpdateIntakeEventData): Promise<IntakeEvent> {
    const event = this.items.find((item) => item.id === id);
    if (!event) throw new Error(`Fake: evento ${id} não existe.`);
    if (data.externalId !== undefined) event.externalId = data.externalId;
    if (data.kind !== undefined) event.kind = data.kind;
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
      if (filters.internetMessageId && item.internetMessageId !== filters.internetMessageId)
        return false;
      if (filters.kind && item.kind !== filters.kind) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.processId && item.processId !== filters.processId) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (pagination.page - 1) * pagination.pageSize;
    return { items: sorted.slice(start, start + pagination.pageSize), total: sorted.length };
  }

  async findLatestReceived(
    channel: IntakeChannel,
    statuses: readonly IntakeEventStatus[],
  ): Promise<IntakeEvent | null> {
    const candidates = this.items.filter(
      (item) => item.channel === channel && statuses.includes(item.status) && item.receivedAt,
    );
    candidates.sort((a, b) => (b.receivedAt?.getTime() ?? 0) - (a.receivedAt?.getTime() ?? 0));
    return candidates[0] ?? null;
  }
}
