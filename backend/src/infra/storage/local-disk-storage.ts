import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { AppError, NotFoundError } from '@/domain/errors/app-error';
import type { SaveFileInput, SavedFile, StorageProvider } from '@/domain/storage/storage-provider';

/**
 * Nome físico = UUID + extensão original do arquivo enviado (docs/12,
 * Tarefa 11). Nunca usa `originalName` como caminho — apenas extrai a
 * extensão, que por si só não permite escape de diretório.
 */
export function generateStoredName(originalName: string): string {
  // path.extname('arquivo') === '' — arquivo sem extensão é aceito (RF-40,
  // "qualquer tipo de arquivo"); path.basename evita que um nome como
  // "../../evil.exe" influencie a extensão extraída.
  const ext = path.extname(path.basename(originalName));
  return `${randomUUID()}${ext}`;
}

/** `{ano}/{mês}/{processId}/{storedName}`, sempre com `/` (persistido no banco). */
export function buildRelativePath(processId: string, storedName: string, now = new Date()): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return [year, month, processId, storedName].join('/');
}

/**
 * Resolve `relativePath` contra `storageRoot` e valida que o caminho final
 * é descendente dele (RNF-11 — path traversal). Lança `AppError` se o
 * caminho escapar, em vez de silenciosamente devolver um caminho fora do
 * diretório de armazenamento.
 *
 * Função pura, testável isoladamente sem precisar subir o Multer/disco
 * real (docs/12, critério de aceite: "teste a função de resolução de
 * caminho isoladamente, não precisa upload malicioso real via multer").
 */
export function resolveContainedPath(storageRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(storageRoot);
  const resolved = path.resolve(normalizedRoot, relativePath);

  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  if (resolved !== normalizedRoot && !resolved.startsWith(rootWithSep)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Caminho de arquivo inválido: fora do diretório de armazenamento.',
      400,
    );
  }

  return resolved;
}

export class LocalDiskStorage implements StorageProvider {
  constructor(private readonly storageRoot: string) {}

  async saveFile(input: SaveFileInput): Promise<SavedFile> {
    const storedName = generateStoredName(input.originalName);
    const relativePath = buildRelativePath(input.processId, storedName);
    const absolutePath = resolveContainedPath(this.storageRoot, relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.buffer);

    const sha256 = createHash('sha256').update(input.buffer).digest('hex');

    return { storedName, relativePath, size: input.buffer.length, sha256 };
  }

  async readFile(relativePath: string): Promise<Buffer> {
    const absolutePath = resolveContainedPath(this.storageRoot, relativePath);
    try {
      return await fs.readFile(absolutePath);
    } catch {
      // RF-42/docs/05: arquivo ausente em disco -> 404, com log em nível
      // error feito pelo chamador (o service tem acesso ao logger/id do
      // documento; aqui só sinaliza o tipo de erro).
      throw new NotFoundError('NOT_FOUND', 'Arquivo não encontrado.');
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    const absolutePath = resolveContainedPath(this.storageRoot, relativePath);
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }
}

/** Cria `STORAGE_ROOT` de forma idempotente na inicialização (docs/10). */
export async function ensureStorageRootExists(storageRoot: string): Promise<void> {
  await fs.mkdir(path.resolve(storageRoot), { recursive: true });
}
