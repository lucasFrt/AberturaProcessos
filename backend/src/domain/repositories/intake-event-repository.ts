import type {
  CreateIntakeEventData,
  IntakeEvent,
  IntakeEventFilters,
  UpdateIntakeEventData,
} from '@/domain/entities/intake-event';
import type { IntakeChannel, IntakeEventStatus } from '@/domain/enums';
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
  /**
   * Insere ou devolve o existente. A chave primária é `(channel, externalId)`
   * (único no banco); `internetMessageId`, quando informado, é checado
   * antes como chave secundária — mesma mensagem com id do Graph novo
   * (movida de pasta) não vira evento novo (docs/14).
   */
  claim(data: CreateIntakeEventData): Promise<ClaimOutcome>;
  findById(id: string): Promise<IntakeEvent | null>;
  findByExternalId(channel: IntakeChannel, externalId: string): Promise<IntakeEvent | null>;
  findByInternetMessageId(
    channel: IntakeChannel,
    internetMessageId: string,
  ): Promise<IntakeEvent | null>;
  update(id: string, data: UpdateIntakeEventData): Promise<IntakeEvent>;
  /** Mais recentes primeiro. Intake é interno (OPERATIONAL/ADMIN), então não recebe `AccessScope`. */
  list(filters: IntakeEventFilters, pagination: PaginationParams): Promise<Page<IntakeEvent>>;
  /**
   * Evento com o maior `receivedAt` entre os de `status` informado — o cursor
   * de leitura da pasta de intake (docs/13, decisão 9). `null` se não há nenhum.
   */
  findLatestReceived(
    channel: IntakeChannel,
    statuses: readonly IntakeEventStatus[],
  ): Promise<IntakeEvent | null>;
}
