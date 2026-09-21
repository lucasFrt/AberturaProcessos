import type { PrismaClient } from '@prisma/client';

import type { IlogSyncState, UpdateIlogSyncStateData } from '@/domain/entities/ilog-sync-state';
import type { IlogSyncKey } from '@/domain/enums';
import type { IlogSyncStateRepository } from '@/domain/repositories/ilog-sync-state-repository';

interface StateRecord {
  key: string;
  lastChangelogAt: string | null;
  backfillDone: boolean;
  lastRunAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

function toDomain(record: StateRecord): IlogSyncState {
  return {
    key: record.key as IlogSyncKey,
    lastChangelogAt: record.lastChangelogAt,
    backfillDone: record.backfillDone,
    lastRunAt: record.lastRunAt,
    lastError: record.lastError,
    updatedAt: record.updatedAt,
  };
}

export class PrismaIlogSyncStateRepository implements IlogSyncStateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(key: IlogSyncKey): Promise<IlogSyncState | null> {
    const row = await this.prisma.ilogSyncState.findUnique({ where: { key } });
    return row ? toDomain(row) : null;
  }

  async update(key: IlogSyncKey, data: UpdateIlogSyncStateData): Promise<IlogSyncState> {
    const fields = {
      ...(data.lastChangelogAt !== undefined ? { lastChangelogAt: data.lastChangelogAt } : {}),
      ...(data.backfillDone !== undefined ? { backfillDone: data.backfillDone } : {}),
      ...(data.lastRunAt !== undefined ? { lastRunAt: data.lastRunAt } : {}),
      ...(data.lastError !== undefined
        ? { lastError: data.lastError === null ? null : data.lastError.slice(0, 1000) }
        : {}),
    };
    const row = await this.prisma.ilogSyncState.upsert({
      where: { key },
      create: { key, ...fields },
      update: fields,
    });
    return toDomain(row);
  }
}
