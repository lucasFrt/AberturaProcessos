import type { IlogSyncState, UpdateIlogSyncStateData } from '@/domain/entities/ilog-sync-state';
import type { IlogSyncKey } from '@/domain/enums';

export interface IlogSyncStateRepository {
  get(key: IlogSyncKey): Promise<IlogSyncState | null>;
  /** Cria a linha se não existir (upsert). */
  update(key: IlogSyncKey, data: UpdateIlogSyncStateData): Promise<IlogSyncState>;
}
