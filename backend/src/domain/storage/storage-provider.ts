/**
 * Abstração de armazenamento de anexos (docs/12, Tarefa 11). Vive no
 * domínio — não em `infra/storage` — porque `DocumentService` (camada de
 * serviço) precisa depender apenas da interface, nunca da implementação em
 * disco; `no-restricted-imports` (eslint.config.js) bloqueia
 * `src/services/**` e `src/domain/**` de importar `@/infra/storage/*`.
 * A implementação padrão (`LocalDiskStorage`) fica em `infra/storage/`,
 * pronta para ser trocada por um provider de nuvem (S3 etc.) sem tocar em
 * regra de negócio.
 */
export interface SaveFileInput {
  processId: string;
  /** Nome enviado pelo usuário — usado apenas para derivar a extensão (RNF-11). */
  originalName: string;
  buffer: Buffer;
}

export interface SavedFile {
  /** UUID + extensão original — nome físico real em disco. */
  storedName: string;
  /** Caminho relativo a STORAGE_ROOT, ex.: "2026/08/<processId>/<storedName>". */
  relativePath: string;
  size: number;
  sha256: string;
}

export interface StorageProvider {
  /** Grava os bytes em disco sob um nome físico gerado e devolve os metadados calculados. */
  saveFile(input: SaveFileInput): Promise<SavedFile>;
  /** Lê o conteúdo do arquivo a partir do caminho relativo, validando containment em STORAGE_ROOT. */
  readFile(relativePath: string): Promise<Buffer>;
  /** Existência do arquivo físico, sem lançar erro. */
  exists(relativePath: string): Promise<boolean>;
}
