import type {
  CreateIntakeEventData,
  IntakeEvent,
  IntakeEventFilters,
  UpdateIntakeEventData,
} from '@/domain/entities/intake-event';
import type { IntakeChannel } from '@/domain/enums';
import type { Page, PaginationParams } from '@/domain/pagination';

/**
 * Resultado do "claim" (docs/13, decisão 4). A unicidade de
 * `(channel, externalId)` é decidida pelo banco, não por um
 * find-then-create — duas execuções simultâneas do agente sobre o mesmo
 * e-mail não podem criar dois eventos.
 */
export type ClaimOutcome =
  { created: true; event: IntakeEvent } | { created: false; existing: IntakeEvent };

export interface IntakeEventRepository {
  /** Insere ou, se `(channel, externalId)` já existe, devolve o existente. */
  claim(data: CreateIntakeEventData): Promise<ClaimOutcome>;
  findById(id: string): Promise<IntakeEvent | null>;
  findByExternalId(channel: IntakeChannel, externalId: string): Promise<IntakeEvent | null>;
  update(id: string, data: UpdateIntakeEventData): Promise<IntakeEvent>;
  /** Mais recentes primeiro. Intake é interno (OPERATIONAL/ADMIN), então não recebe `AccessScope`. */
  list(filters: IntakeEventFilters, pagination: PaginationParams): Promise<Page<IntakeEvent>>;
}
