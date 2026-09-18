import type { IntakeChannel, IntakeEventKind, IntakeEventStatus } from '@/domain/enums';

/**
 * Um e-mail recebido pelo intake (docs/13, decisão 4). Único por
 * `(channel, externalId)` — é o que torna o agente idempotente: a mesma
 * mensagem processada duas vezes devolve o mesmo resultado em vez de criar
 * um segundo processo.
 */
export interface IntakeEvent {
  id: string;
  channel: IntakeChannel;
  externalId: string;
  /**
   * Message-ID RFC 5322 (chave secundária de idempotência, docs/14): o id
   * do Graph muda quando a mensagem é movida de pasta; este não.
   */
  internetMessageId: string | null;
  kind: IntakeEventKind;
  status: IntakeEventStatus;
  subject: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  receivedAt: Date | null;
  processId: string | null;
  /** Resultado gravado ao concluir, para responder duplicatas sem refazer nada. */
  result: IntakeEventResult | null;
  errorMessage: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** O que foi feito, serializado em `IntakeEvent.result` (JSON no banco). */
export interface IntakeEventResult {
  documentIds: string[];
  warnings: string[];
  company: { id: string; created: boolean } | null;
  organization: { id: string; created: boolean; domainRegistered: boolean } | null;
}

export interface CreateIntakeEventData {
  channel: IntakeChannel;
  externalId: string;
  internetMessageId: string | null;
  kind: IntakeEventKind;
  status: IntakeEventStatus;
  subject: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  receivedAt: Date | null;
  createdById: string;
}

export interface UpdateIntakeEventData {
  /** Retomada de evento FAILED encontrado por `internetMessageId`: o id do Graph pode ter mudado. */
  externalId?: string | undefined;
  /** Retomada pode mudar a ação (ex.: 404 em ATTACHMENT → tratar como PROCESS). */
  kind?: IntakeEventKind | undefined;
  status?: IntakeEventStatus | undefined;
  processId?: string | null | undefined;
  result?: IntakeEventResult | null | undefined;
  errorMessage?: string | null | undefined;
}

export interface IntakeEventFilters {
  externalId?: string | undefined;
  internetMessageId?: string | undefined;
  status?: IntakeEventStatus | undefined;
  processId?: string | undefined;
}
