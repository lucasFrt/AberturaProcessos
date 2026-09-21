import type { PrismaClient } from '@prisma/client';

import type { IntakeCursorRecord } from '@/domain/entities/intake-cursor';
import type { IntakeChannel } from '@/domain/enums';
import type { IntakeCursorRepository } from '@/domain/repositories/intake-cursor-repository';

interface IntakeCursorRow {
  channel: string;
  receivedAt: Date;
  externalId: string | null;
  updatedAt: Date;
}

/** `channel` é String no banco (sem enum no SQL Server); a CHECK constraint garante o valor. */
function toDomain(row: IntakeCursorRow): IntakeCursorRecord {
  return {
    channel: row.channel as IntakeChannel,
    receivedAt: row.receivedAt,
    externalId: row.externalId,
    updatedAt: row.updatedAt,
  };
}

export class PrismaIntakeCursorRepository implements IntakeCursorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(channel: IntakeChannel): Promise<IntakeCursorRecord | null> {
    const row = await this.prisma.intakeCursor.findUnique({ where: { channel } });
    return row ? toDomain(row) : null;
  }

  async set(
    channel: IntakeChannel,
    receivedAt: Date,
    externalId: string | null,
  ): Promise<IntakeCursorRecord> {
    const row = await this.prisma.intakeCursor.upsert({
      where: { channel },
      create: { channel, receivedAt, externalId },
      update: { receivedAt, externalId },
    });
    return toDomain(row);
  }
}
