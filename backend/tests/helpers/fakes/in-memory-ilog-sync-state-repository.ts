import type { IlogSyncState, UpdateIlogSyncStateData } from '@/domain/entities/ilog-sync-state';
import type { IlogSyncKey } from '@/domain/enums';
import type { IlogSyncStateRepository } from '@/domain/repositories/ilog-sync-state-repository';

export class InMemoryIlogSyncStateRepository implements IlogSyncStateRepository {
  readonly items = new Map<IlogSyncKey, IlogSyncState>();

  async get(key: IlogSyncKey): Promise<IlogSyncState | null> {
    return this.items.get(key) ?? null;
  }

  async update(key: IlogSyncKey, data: UpdateIlogSyncStateData): Promise<IlogSyncState> {
    const current: IlogSyncState = this.items.get(key) ?? {
      key,
      lastChangelogAt: null,
      backfillDone: false,
      lastRunAt: null,
      lastError: null,
      updatedAt: new Date(),
    };
    const updated: IlogSyncState = {
      ...current,
      ...(data.lastChangelogAt !== undefined ? { lastChangelogAt: data.lastChangelogAt } : {}),
      ...(data.backfillDone !== undefined ? { backfillDone: data.backfillDone } : {}),
      ...(data.lastRunAt !== undefined ? { lastRunAt: data.lastRunAt } : {}),
      ...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
      updatedAt: new Date(),
    };
    this.items.set(key, updated);
    return updated;
  }
}
