import type { PrismaClient } from '@prisma/client';

import type {
  ProcessIdentifier,
  ProcessIdentifierInput,
  ProcessIdentifierMatch,
} from '@/domain/entities/process-identifier';
import { normalizeIdentifier } from '@/domain/entities/process-identifier';
import type { ProcessIdentifierKind, ProcessIdentifierSource } from '@/domain/enums';
import type { ProcessIdentifierRepository } from '@/domain/repositories/process-identifier-repository';

interface IdentifierRecord {
  id: string;
  processId: string;
  kind: string;
  value: string;
  normalized: string;
  source: string;
  createdAt: Date;
}

interface NormalizedInput {
  kind: ProcessIdentifierKind;
  value: string;
  normalized: string;
}

/** `kind`/`source` são String no banco (sem enum no SQL Server, docs/04); as CHECK constraints garantem o valor. */
function toDomain(record: IdentifierRecord): ProcessIdentifier {
  return {
    id: record.id,
    processId: record.processId,
    kind: record.kind as ProcessIdentifierKind,
    value: record.value,
    normalized: record.normalized,
    source: record.source as ProcessIdentifierSource,
    createdAt: record.createdAt,
  };
}

function keyOf(item: { kind: string; normalized: string }): string {
  return `${item.kind}:${item.normalized}`;
}

/** Remove duplicatas de `(kind, normalized)` e valores que normalizam para vazio. */
function dedupe(identifiers: ProcessIdentifierInput[]): NormalizedInput[] {
  const seen = new Set<string>();
  const out: NormalizedInput[] = [];
  for (const identifier of identifiers) {
    const value = identifier.value.trim().slice(0, 255);
    const normalized = normalizeIdentifier(value);
    if (normalized.length === 0) continue;
    const item = { kind: identifier.kind, value, normalized };
    if (seen.has(keyOf(item))) continue;
    seen.add(keyOf(item));
    out.push(item);
  }
  return out;
}

export class PrismaProcessIdentifierRepository implements ProcessIdentifierRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByProcess(processId: string): Promise<ProcessIdentifier[]> {
    const rows = await this.prisma.processIdentifier.findMany({
      where: { processId },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findByNormalized(normalized: string[]): Promise<ProcessIdentifierMatch[]> {
    const wanted = [...new Set(normalized.filter((value) => value.length > 0))];
    if (wanted.length === 0) return [];
    const rows = await this.prisma.processIdentifier.findMany({
      where: { normalized: { in: wanted }, process: { deletedAt: null } },
      orderBy: [{ createdAt: 'asc' }],
      take: 200,
    });
    return rows.map((row) => ({
      processId: row.processId,
      kind: row.kind as ProcessIdentifierKind,
      value: row.value,
      normalized: row.normalized,
    }));
  }

  async addForProcess(
    processId: string,
    source: ProcessIdentifierSource,
    identifiers: ProcessIdentifierInput[],
  ): Promise<number> {
    const wanted = dedupe(identifiers);
    if (wanted.length === 0) return 0;

    const existing = await this.prisma.processIdentifier.findMany({
      where: { processId, normalized: { in: wanted.map((item) => item.normalized) } },
      select: { kind: true, normalized: true },
    });
    const present = new Set(existing.map(keyOf));
    const missing = wanted.filter((item) => !present.has(keyOf(item)));
    if (missing.length === 0) return 0;

    // Sem `skipDuplicates` no SQL Server: a leitura acima resolve o caso comum
    // e a unicidade do banco segura a corrida rara (o erro P2002 sobe).
    const result = await this.prisma.processIdentifier.createMany({
      data: missing.map((item) => ({
        processId,
        kind: item.kind,
        value: item.value,
        normalized: item.normalized,
        source,
      })),
    });
    return result.count;
  }

  async replaceForProcess(
    processId: string,
    source: ProcessIdentifierSource,
    identifiers: ProcessIdentifierInput[],
  ): Promise<void> {
    const wanted = dedupe(identifiers);
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.processIdentifier.findMany({ where: { processId } });
      const wantedKeys = new Set(wanted.map(keyOf));

      // Some o que era desta fonte e não é mais; o que já existia por outra
      // fonte e a fonte agora também tem passa a ser desta (o iLog confirma).
      const stale = current.filter((row) => row.source === source && !wantedKeys.has(keyOf(row)));
      if (stale.length > 0) {
        await tx.processIdentifier.deleteMany({
          where: { id: { in: stale.map((row) => row.id) } },
        });
      }

      const currentByKey = new Map(current.map((row) => [keyOf(row), row]));
      for (const item of wanted) {
        const existing = currentByKey.get(keyOf(item));
        if (!existing) {
          await tx.processIdentifier.create({
            data: {
              processId,
              kind: item.kind,
              value: item.value,
              normalized: item.normalized,
              source,
            },
          });
        } else if (existing.source !== source || existing.value !== item.value) {
          await tx.processIdentifier.update({
            where: { id: existing.id },
            data: { source, value: item.value },
          });
        }
      }
    });
  }
}
