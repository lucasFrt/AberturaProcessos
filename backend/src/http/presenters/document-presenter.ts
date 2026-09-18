import type { DocumentWithUploader } from '@/domain/entities/document';

/** Monta o DTO campo a campo — nunca `...document` (docs/06, checklist de segurança). */

interface UserSummaryDto {
  id: string;
  name: string;
}

interface DocumentDto {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: UserSummaryDto;
  source: string;
  receivedAt: string | null;
  createdAt: string;
}

export function presentDocument(document: DocumentWithUploader): DocumentDto {
  return {
    id: document.id,
    originalName: document.originalName,
    mimeType: document.mimeType,
    size: document.size,
    uploadedBy: { id: document.uploadedBy.id, name: document.uploadedBy.name },
    source: document.source,
    receivedAt: document.receivedAt ? document.receivedAt.toISOString() : null,
    createdAt: document.createdAt.toISOString(),
  };
}
