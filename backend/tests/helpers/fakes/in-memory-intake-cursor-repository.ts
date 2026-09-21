import type { IntakeCursorRecord } from '@/domain/entities/intake-cursor';
import type { IntakeChannel } from '@/domain/enums';
import type { IntakeCursorRepository } from '@/domain/repositories/intake-cursor-repository';

/** Fake em memória de IntakeCursorRepository (docs/09). */
export class InMemoryIntakeCursorRepository implements IntakeCursorRepository {
  readonly items = new Map<IntakeChannel, IntakeCursorRecord>();

  async get(channel: IntakeChannel): Promise<IntakeCursorRecord | null> {
    return this.items.get(channel) ?? null;
  }

  async set(
    channel: IntakeChannel,
    receivedAt: Date,
    externalId: string | null,
  ): Promise<IntakeCursorRecord> {
    const record: IntakeCursorRecord = { channel, receivedAt, externalId, updatedAt: new Date() };
    this.items.set(channel, record);
    return record;
  }
}
