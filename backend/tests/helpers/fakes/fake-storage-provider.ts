import { createHash, randomUUID } from 'node:crypto';

import { NotFoundError } from '@/domain/errors/app-error';
import type { SaveFileInput, SavedFile, StorageProvider } from '@/domain/storage/storage-provider';

/** Fake em memória de StorageProvider (docs/09, `tests/unit` com fakes) — sem tocar em disco. */
export class FakeStorageProvider implements StorageProvider {
  readonly savedFiles = new Map<string, Buffer>();

  async saveFile(input: SaveFileInput): Promise<SavedFile> {
    const storedName = `${randomUUID()}-${input.originalName}`;
    const relativePath = `fake/${input.processId}/${storedName}`;
    this.savedFiles.set(relativePath, input.buffer);
    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    return { storedName, relativePath, size: input.buffer.length, sha256 };
  }

  async readFile(relativePath: string): Promise<Buffer> {
    const buffer = this.savedFiles.get(relativePath);
    if (!buffer) {
      throw new NotFoundError('NOT_FOUND', 'Arquivo não encontrado.');
    }
    return buffer;
  }

  async exists(relativePath: string): Promise<boolean> {
    return this.savedFiles.has(relativePath);
  }
}
