import type { IntakeEvent } from '@/domain/entities/intake-event';
import { calculateProcessPermissions } from '@/domain/entities/process-permissions';
import type { Role } from '@/domain/enums';
import { presentProcessDetail, presentProcessListItem } from '@/http/presenters/process-presenter';
import type {
  AdvanceCursorResult,
  IntakeCursor,
  IntakeResult,
  ListMailboxResult,
  MailboxMessageView,
  ProcessMatch,
  SkipBatchItemResult,
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

type SkipBatchItemDto =
  | { externalId: string; ok: true; duplicate: boolean; event: IntakeEventDto }
  | { externalId: string; ok: false; error: { code: string; message: string } };

interface SkipBatchResultDto {
  recorded: number;
  duplicates: number;
  failed: number;
  results: SkipBatchItemDto[];
}

export function presentSkipBatchResult(results: SkipBatchItemResult[]): SkipBatchResultDto {
  return {
    recorded: results.filter((item) => item.ok && !item.duplicate).length,
    duplicates: results.filter((item) => item.ok && item.duplicate).length,
    failed: results.filter((item) => !item.ok).length,
    results: results.map((item) =>
      item.ok
        ? {
            externalId: item.externalId,
            ok: true,
            duplicate: item.duplicate,
            event: presentIntakeEvent(item.event),
          }
        : {
            externalId: item.externalId,
            ok: false,
            error: { code: item.error.code, message: item.error.message },
          },
    ),
  };
}

interface IntakeCursorDto {
  channel: string;
  receivedAt: string | null;
  externalId: string | null;
  source: 'STORED' | 'EVENTS' | 'NONE';
}

export function presentIntakeCursor(cursor: IntakeCursor): IntakeCursorDto {
  return {
    channel: cursor.channel,
    receivedAt: cursor.receivedAt ? cursor.receivedAt.toISOString() : null,
    externalId: cursor.externalId,
    source: cursor.source,
  };
}

interface AdvanceCursorDto {
  advanced: boolean;
  cursor: IntakeCursorDto;
}

export function presentAdvanceCursor(result: AdvanceCursorResult): AdvanceCursorDto {
  return { advanced: result.advanced, cursor: presentIntakeCursor(result.cursor) };
}

interface MailboxMessageSummaryDto {
  id: string;
  internetMessageId: string | null;
  subject: string;
  from: { name: string | null; email: string | null };
  receivedAt: string;
  hasAttachments: boolean;
  preview: string;
}

interface MailboxListItemDto extends MailboxMessageSummaryDto {
  intake: { eventId: string; status: string; kind: string; processId: string | null } | null;
}

interface ListMailboxDto {
  messages: MailboxListItemDto[];
  listed: number;
  blocked: number;
  nextAfter: string | null;
  hasMore: boolean;
}

export function presentListMailbox(result: ListMailboxResult): ListMailboxDto {
  return {
    messages: result.messages.map((message) => ({
      id: message.id,
      internetMessageId: message.internetMessageId,
      subject: message.subject,
      from: { name: message.from.name, email: message.from.email },
      receivedAt: message.receivedAt.toISOString(),
      hasAttachments: message.hasAttachments,
      preview: message.preview,
      intake: message.intake
        ? {
            eventId: message.intake.eventId,
            status: message.intake.status,
            kind: message.intake.kind,
            processId: message.intake.processId,
          }
        : null,
    })),
    listed: result.listed,
    blocked: result.blocked,
    nextAfter: result.nextAfter ? result.nextAfter.toISOString() : null,
    hasMore: result.hasMore,
  };
}

interface MailboxMessageDto extends MailboxMessageSummaryDto {
  to: string[];
  cc: string[];
  attachments: Array<{ name: string; mimeType: string; size: number }>;
  bodyText: string;
  bodyTruncated: boolean;
}

export function presentMailboxMessage(message: MailboxMessageView): MailboxMessageDto {
  return {
    id: message.id,
    internetMessageId: message.internetMessageId,
    subject: message.subject,
    from: { name: message.from.name, email: message.from.email },
    receivedAt: message.receivedAt.toISOString(),
    hasAttachments: message.hasAttachments,
    preview: message.bodyText.slice(0, 200),
    to: [...message.to],
    cc: [...message.cc],
    attachments: message.attachments.map((attachment) => ({
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    bodyText: message.bodyText,
    bodyTruncated: message.bodyTruncated,
  };
}

interface ProcessMatchDto {
  matchedBy: string;
  ref: string | null;
  process: ReturnType<typeof presentProcessListItem>;
}

export function presentProcessMatch(match: ProcessMatch): ProcessMatchDto {
  return {
    matchedBy: match.matchedBy,
    ref: match.ref,
    process: presentProcessListItem(match.process),
  };
}
