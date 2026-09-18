import type { UserSummary } from '@/domain/entities/process';
import type { RecordSource } from '@/domain/enums';

/**
 * Entidade de domínio de Document (docs/04, model Document; RF-40 a
 * RF-44). `originalName` nunca é usado como caminho físico — o nome real
 * em disco é `storedName` (UUID + extensão), validado como descendente de
 * `STORAGE_ROOT` (RNF-11).
 */
export interface Document {
  id: string;
  processId: string;
  originalName: string;
  storedName: string;
  relativePath: string;
  mimeType: string;
  size: number;
  sha256: string;
  uploadedById: string;
  /** Origem e data de recebimento (docs/13, decisão 7). `receivedAt` null = igual a `createdAt`. */
  source: RecordSource;
  receivedAt: Date | null;
  deletedAt: Date | null;
  deletedById: string | null;
  createdAt: Date;
}

/** Detalhe com o autor do upload resumido, para listagem/download (docs/05). */
export interface DocumentWithUploader extends Document {
  uploadedBy: UserSummary;
}

export interface CreateDocumentData {
  processId: string;
  originalName: string;
  storedName: string;
  relativePath: string;
  mimeType: string;
  size: number;
  sha256: string;
  uploadedById: string;
  source: RecordSource;
  receivedAt: Date | null;
}

export interface CreateDocumentWithHistoryInput {
  processId: string;
  documents: CreateDocumentData[];
  actorId: string;
}

export interface SoftDeleteDocumentWithHistoryInput {
  processId: string;
  actorId: string;
  description: string;
}
