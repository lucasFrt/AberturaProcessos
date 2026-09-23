import type { Prisma, PrismaClient } from '@prisma/client';

import type {
  CreateIntakeEventData,
  IntakeEvent,
  IntakeEventFilters,
  IntakeEventResult,
  UpdateIntakeEventData,
} from '@/domain/entities/intake-event';
import type { IntakeChannel, IntakeEventKind, IntakeEventStatus } from '@/domain/enums';
import type { Page, PaginationParams } from '@/domain/pagination';
import type {
  ClaimOutcome,
  IntakeEventRepository,
} from '@/domain/repositories/intake-event-repository';

interface IntakeEventRow {
  id: string;
  channel: string;
  externalId: string;
  internetMessageId: string | null;
  kind: string;
  status: string;
  subject: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  receivedAt: Date | null;
  processId: string | null;
  result: string | null;
  errorMessage: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

function parseResult(raw: string | null): IntakeEventResult | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const value = parsed as Partial<IntakeEventResult>;
    return {
      documentIds: Array.isArray(value.documentIds) ? value.documentIds : [],
      warnings: Array.isArray(value.warnings) ? value.warnings : [],
      company: value.company ?? null,
      organization: value.organization ?? null,
      reason: typeof value.reason === 'string' ? value.reason : null,
    };
  } catch {
    return null;
  }
}

/** `channel`/`kind`/`status` são String no banco; as CHECK constraints garantem os valores. */
function toDomain(row: IntakeEventRow): IntakeEvent {
  return {
    id: row.id,
    channel: row.channel as IntakeChannel,
    externalId: row.externalId,
    internetMessageId: row.internetMessageId,
    kind: row.kind as IntakeEventKind,
    status: row.status as IntakeEventStatus,
    subject: row.subject,
    requesterName: row.requesterName,
    requesterEmail: row.requesterEmail,
    receivedAt: row.receivedAt,
    processId: row.processId,
    result: parseResult(row.result),
    errorMessage: row.errorMessage,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export class PrismaIntakeEventRepository implements IntakeEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Tenta inserir e deixa o índice único decidir (docs/13, decisão 4). Um
   * `findFirst` antes do `create` abriria a janela clássica em que duas
   * execuções do agente passam pela checagem e as duas inserem.
   */
  async claim(data: CreateIntakeEventData): Promise<ClaimOutcome> {
    // Chave secundária primeiro (docs/14): a mesma mensagem com id do Graph
    // novo (movida de pasta) tem de cair no evento já existente. Não é
    // unique no banco — é uma checagem best-effort antes da chave primária.
    if (data.internetMessageId) {
      const byMessageId = await this.findByInternetMessageId(data.channel, data.internetMessageId);
      if (byMessageId) return { created: false, existing: byMessageId };
    }

    try {
      const row = await this.prisma.intakeEvent.create({ data });
      return { created: true, event: toDomain(row) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findByExternalId(data.channel, data.externalId);
      if (!existing) throw error;
      return { created: false, existing };
    }
  }

  async findById(id: string): Promise<IntakeEvent | null> {
    const row = await this.prisma.intakeEvent.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByExternalId(channel: IntakeChannel, externalId: string): Promise<IntakeEvent | null> {
    const row = await this.prisma.intakeEvent.findUnique({
      where: { channel_externalId: { channel, externalId } },
    });
    return row ? toDomain(row) : null;
  }

  async findByInternetMessageId(
    channel: IntakeChannel,
    internetMessageId: string,
  ): Promise<IntakeEvent | null> {
    const row = await this.prisma.intakeEvent.findFirst({
      where: { channel, internetMessageId },
      orderBy: { createdAt: 'asc' },
    });
    return row ? toDomain(row) : null;
  }

  async findByMessages(
    channel: IntakeChannel,
    externalIds: readonly string[],
    internetMessageIds: readonly string[],
  ): Promise<IntakeEvent[]> {
    const or: Prisma.IntakeEventWhereInput[] = [];
    if (externalIds.length > 0) or.push({ externalId: { in: [...externalIds] } });
    if (internetMessageIds.length > 0) {
      or.push({ internetMessageId: { in: [...internetMessageIds] } });
    }
    if (or.length === 0) return [];
    const rows = await this.prisma.intakeEvent.findMany({ where: { channel, OR: or } });
    return rows.map(toDomain);
  }

  async update(id: string, data: UpdateIntakeEventData): Promise<IntakeEvent> {
    const updateData: Prisma.IntakeEventUpdateInput = {
      ...(data.externalId !== undefined ? { externalId: data.externalId } : {}),
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.processId !== undefined
        ? data.processId === null
          ? { process: { disconnect: true } }
          : { process: { connect: { id: data.processId } } }
        : {}),
      ...(data.result !== undefined
        ? { result: data.result === null ? null : JSON.stringify(data.result) }
        : {}),
      ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
    };
    const row = await this.prisma.intakeEvent.update({ where: { id }, data: updateData });
    return toDomain(row);
  }

  async list(
    filters: IntakeEventFilters,
    pagination: PaginationParams,
  ): Promise<Page<IntakeEvent>> {
    const where: Prisma.IntakeEventWhereInput = {
      ...(filters.externalId ? { externalId: filters.externalId } : {}),
      ...(filters.internetMessageId ? { internetMessageId: filters.internetMessageId } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.processId ? { processId: filters.processId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.intakeEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.intakeEvent.count({ where }),
    ]);

    return { items: rows.map(toDomain), total };
  }

  async findLatestReceived(
    channel: IntakeChannel,
    statuses: readonly IntakeEventStatus[],
  ): Promise<IntakeEvent | null> {
    const row = await this.prisma.intakeEvent.findFirst({
      where: { channel, status: { in: [...statuses] }, receivedAt: { not: null } },
      orderBy: { receivedAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }
}
