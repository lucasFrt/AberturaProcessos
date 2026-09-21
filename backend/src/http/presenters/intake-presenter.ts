import type { IntakeEvent } from '@/domain/entities/intake-event';
import { calculateProcessPermissions } from '@/domain/entities/process-permissions';
import type { Role } from '@/domain/enums';
import { presentProcessDetail, presentProcessListItem } from '@/http/presenters/process-presenter';
import type {
  IntakeCursor,
  IntakeResult,
  ProcessMatch,
  SkipIntakeResult,
} from '@/services/intake-service';

/** Monta o DTO campo a campo — nunca `...event` (docs/06, checklist de segurança). */

interface IntakeEventDto {
  id: string;
  channel: string;
  externalId: string;
  internetMessageId: string | null;
  kind: string;
  status: string;
  subject: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  receivedAt: string | null;
  processId: string | null;
  result: {
    documentIds: string[];
    warnings: string[];
    company: { id: string; created: boolean } | null;
    organization: { id: string; created: boolean; domainRegistered: boolean } | null;
    reason: string | null;
  } | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export function presentIntakeEvent(event: IntakeEvent): IntakeEventDto {
  return {
    id: event.id,
    channel: event.channel,
    externalId: event.externalId,
    internetMessageId: event.internetMessageId,
    kind: event.kind,
    status: event.status,
    subject: event.subject,
    requesterName: event.requesterName,
    requesterEmail: event.requesterEmail,
    receivedAt: event.receivedAt ? event.receivedAt.toISOString() : null,
    processId: event.processId,
    result: event.result
      ? {
          documentIds: [...event.result.documentIds],
          warnings: [...event.result.warnings],
          company: event.result.company
            ? { id: event.result.company.id, created: event.result.company.created }
            : null,
          organization: event.result.organization
            ? {
                id: event.result.organization.id,
                created: event.result.organization.created,
                domainRegistered: event.result.organization.domainRegistered,
              }
            : null,
          reason: event.result.reason,
        }
      : null,
    errorMessage: event.errorMessage,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

interface IntakeResultDto {
  duplicate: boolean;
  event: IntakeEventDto;
  process: ReturnType<typeof presentProcessDetail>;
  documents: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    receivedAt: string | null;
    createdAt: string;
  }>;
  company: { id: string; created: boolean } | null;
  organization: { id: string; created: boolean; domainRegistered: boolean } | null;
  warnings: string[];
}

export function presentIntakeResult(result: IntakeResult, actorRole: Role): IntakeResultDto {
  return {
    duplicate: result.duplicate,
    event: presentIntakeEvent(result.event),
    process: presentProcessDetail(result.process, calculateProcessPermissions(actorRole)),
    documents: result.documents.map((doc) => ({
      id: doc.id,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      size: doc.size,
      receivedAt: doc.receivedAt ? doc.receivedAt.toISOString() : null,
      createdAt: doc.createdAt.toISOString(),
    })),
    company: result.company ? { id: result.company.id, created: result.company.created } : null,
    organization: result.organization
      ? {
          id: result.organization.id,
          created: result.organization.created,
          domainRegistered: result.organization.domainRegistered,
        }
      : null,
    warnings: [...result.warnings],
  };
}

interface SkipIntakeResultDto {
  duplicate: boolean;
  event: IntakeEventDto;
}

export function presentSkipIntakeResult(result: SkipIntakeResult): SkipIntakeResultDto {
  return { duplicate: result.duplicate, event: presentIntakeEvent(result.event) };
}

interface IntakeCursorDto {
  channel: string;
  receivedAt: string | null;
  event: IntakeEventDto | null;
}

export function presentIntakeCursor(cursor: IntakeCursor): IntakeCursorDto {
  return {
    channel: cursor.channel,
    receivedAt: cursor.receivedAt ? cursor.receivedAt.toISOString() : null,
    event: cursor.event ? presentIntakeEvent(cursor.event) : null,
  };
}

interface ProcessMatchDto {
  matchedBy: string;
  process: ReturnType<typeof presentProcessListItem>;
}

export function presentProcessMatch(match: ProcessMatch): ProcessMatchDto {
  return { matchedBy: match.matchedBy, process: presentProcessListItem(match.process) };
}
