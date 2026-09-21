import type { IntakeCursorRecord } from '@/domain/entities/intake-cursor';
import type { IntakeChannel } from '@/domain/enums';

export interface IntakeCursorRepository {
  get(channel: IntakeChannel): Promise<IntakeCursorRecord | null>;
  /** Grava (upsert) o ponteiro do canal. A monotonicidade é decidida no service. */
  set(
    channel: IntakeChannel,
    receivedAt: Date,
    externalId: string | null,
  ): Promise<IntakeCursorRecord>;
}
