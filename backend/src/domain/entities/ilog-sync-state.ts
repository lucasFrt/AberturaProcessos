import type { IlogSyncKey } from '@/domain/enums';

/** Estado do espelho incremental do iLog (docs/15, seção 5.2) — uma linha por chave. */
export interface IlogSyncState {
  key: IlogSyncKey;
  /**
   * `changelog.ChangedDateTime` até onde o incremental leu, no formato e fuso
   * do MySQL ("2026-09-21 17:20:03"). Fica como texto de propósito: volta
   * tal qual para a próxima consulta, sem conversão de fuso em nenhum lado.
   */
  lastChangelogAt: string | null;
  backfillDone: boolean;
  lastRunAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

export interface UpdateIlogSyncStateData {
  lastChangelogAt?: string | null | undefined;
  backfillDone?: boolean | undefined;
  lastRunAt?: Date | null | undefined;
  lastError?: string | null | undefined;
}
