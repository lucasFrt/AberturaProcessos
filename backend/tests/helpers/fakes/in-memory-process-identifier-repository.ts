import type {
  ProcessIdentifier,
  ProcessIdentifierInput,
  ProcessIdentifierMatch,
} from '@/domain/entities/process-identifier';
import { normalizeIdentifier } from '@/domain/entities/process-identifier';
import type { ProcessIdentifierSource } from '@/domain/enums';
import type { ProcessIdentifierRepository } from '@/domain/repositories/process-identifier-repository';

let idCounter = 0;

/**
 * Fake em memória do índice de identificadores (docs/15). Quando ligado a
 * um `InMemoryProcessRepository` (`items` compartilhado), respeita a
 * exclusão lógica e alimenta o detalhe do processo; sozinho, serve para o
 * `ProcessService`/`IntakeService` gravarem e buscarem.
 */
export class InMemoryProcessIdentifierRepository implements ProcessIdentifierRepository {
  constructor(
    readonly items: ProcessIdentifier[] = [],
    private readonly isProcessActive: (processId: string) => boolean = () => true,
  ) {}

  async listByProcess(processId: string): Promise<ProcessIdentifier[]> {
    return this.items.filter((item) => item.processId === processId);
  }

  async findByNormalized(normalized: string[]): Promise<ProcessIdentifierMatch[]> {
    const wanted = new Set(normalized.filter((value) => value.length > 0));
    return this.items
      .filter((item) => wanted.has(item.normalized) && this.isProcessActive(item.processId))
      .map((item) => ({
        processId: item.processId,
        kind: item.kind,
        value: item.value,
        normalized: item.normalized,
      }));
  }

  async addForProcess(
    processId: string,
    source: ProcessIdentifierSource,
    identifiers: ProcessIdentifierInput[],
  ): Promise<number> {
    let added = 0;
    for (const identifier of identifiers) {
      const value = identifier.value.trim();
      const normalized = normalizeIdentifier(value);
      if (normalized.length === 0) continue;
      const exists = this.items.some(
        (item) =>
          item.processId === processId &&
          item.kind === identifier.kind &&
          item.normalized === normalized,
      );
      if (exists) continue;
      idCounter += 1;
      this.items.push({
        id: `identifier-${idCounter}`,
        processId,
        kind: identifier.kind,
        value,
        normalized,
        source,
        createdAt: new Date(),
      });
      added += 1;
    }
    return added;
  }

  async replaceForProcess(
    processId: string,
    source: ProcessIdentifierSource,
    identifiers: ProcessIdentifierInput[],
  ): Promise<void> {
    const wantedKeys = new Set(
      identifiers.map((item) => `${item.kind}:${normalizeIdentifier(item.value)}`),
    );
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      if (
        item &&
        item.processId === processId &&
        item.source === source &&
        !wantedKeys.has(`${item.kind}:${item.normalized}`)
      ) {
        this.items.splice(index, 1);
      }
    }
    for (const identifier of identifiers) {
      const normalized = normalizeIdentifier(identifier.value);
      const existing = this.items.find(
        (item) =>
          item.processId === processId &&
          item.kind === identifier.kind &&
          item.normalized === normalized,
      );
      if (existing) {
        existing.source = source;
        existing.value = identifier.value.trim();
      }
    }
    await this.addForProcess(processId, source, identifiers);
  }
}
