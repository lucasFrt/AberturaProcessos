import type { UserSummary } from '@/domain/entities/process';

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
