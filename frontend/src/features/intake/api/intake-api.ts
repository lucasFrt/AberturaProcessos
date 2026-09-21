import { api } from '@/shared/api/http-client';
import type { Paginated } from '@/shared/types';

/**
 * Eventos do intake por e-mail (docs/05, "Intake"; docs/13, decisões 9 e
 * 12): o que a IA fez com cada e-mail — processo criado, documento anexado,
 * ignorado ou escalado, com o motivo. É a tela que substitui o relatório
 * por e-mail. OPERATIONAL e ADMIN, por JWT (a mesma rota que a chave de API
 * do agente usa).
 */

export type IntakeEventKind = 'PROCESS' | 'ATTACHMENT' | 'IGNORED' | 'ESCALATED';
export type IntakeEventStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface IntakeEventDto {
  id: string;
  channel: string;
  externalId: string;
  internetMessageId: string | null;
  kind: IntakeEventKind;
  status: IntakeEventStatus;
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

export interface ListIntakeEventsParams {
  kind?: IntakeEventKind;
  status?: IntakeEventStatus;
  page?: number;
  pageSize?: number;
}

export async function listIntakeEvents(
  params: ListIntakeEventsParams = {},
): Promise<Paginated<IntakeEventDto>> {
  const { data } = await api.get<Paginated<IntakeEventDto>>('/intake/events', { params });
  return data;
}

export interface IntakeCursorDto {
  channel: string;
  receivedAt: string | null;
  externalId: string | null;
  source: 'STORED' | 'EVENTS' | 'NONE';
}

export async function getIntakeCursor(): Promise<IntakeCursorDto> {
  const { data } = await api.get<IntakeCursorDto>('/intake/cursor');
  return data;
}
