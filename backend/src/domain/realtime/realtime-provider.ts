import type { ProcessListItem } from '@/domain/entities/process';

/**
 * Tempo real via Socket.IO (RF-53, RF-54; docs/07-filas-notificacoes-realtime.md
 * seção "Tempo real (Socket.IO)"; docs/05-contrato-api.md seção "Eventos
 * WebSocket"). Vive no domínio pelo mesmo motivo de
 * `domain/queue/queue-provider.ts`: `ProcessService`/`KanbanStageService`/
 * `DocumentService` (camada de serviço) precisam depender só desta
 * interface, nunca do Socket.IO. `no-restricted-imports`
 * (eslint.config.js) bloqueia `src/services/**` e `src/domain/**` de
 * importar `@/infra/realtime/*`.
 */
export interface ProcessMovedEventPayload {
  processId: string;
  fromStageId: string;
  toStageId: string;
  actor: { id: string; name: string };
  at: string; // ISO
}

/**
 * União discriminada dos eventos de processo (docs/05, tabela "Eventos
 * WebSocket"). Os payloads são enxutos de propósito — exceção feita a
 * `process:moved`, que carrega `fromStageId`/`toStageId` para permitir
 * atualização otimista da posição do card antes do refetch (docs/07).
 */
export type ProcessRealtimeEvent =
  | { name: 'process:created'; payload: { process: ProcessListItem } }
  | { name: 'process:moved'; payload: ProcessMovedEventPayload }
  | { name: 'process:updated'; payload: { processId: string } }
  | { name: 'process:deleted'; payload: { processId: string } };

/**
 * CNPJs que definem quem pode ver o processo (docs/07, seção "Salas"): a
 * emissão sempre alcança `role:internal` + o(s) CNPJ(s) do processo — cobre
 * o caso trading em que `requestingCompany` difere de `clientCompany`.
 */
export interface ProcessEventTarget {
  clientCompanyId: string;
  requestingCompanyId: string | null;
}

/**
 * O service não conhece Socket.IO. Isso permite testar regra de negócio
 * com um fake que apenas registra as chamadas (mesmo espírito de
 * `QueueProvider`), e trocar a implementação sem tocar em domínio.
 */
export interface RealtimeProvider {
  /** Emite um evento de processo para as salas resolvidas a partir de `target`. */
  emitProcessEvent(event: ProcessRealtimeEvent, target: ProcessEventTarget): void;
  /**
   * `stages:changed` não tem payload nem sala específica: etapas do
   * Kanban são globais, não por organização/CNPJ (docs/05, docs/12
   * critério de aceite da Tarefa 8) — alcança todos os sockets conectados.
   */
  emitStagesChanged(): void;
  /** Encerramento ordenado (RNF-12; docs/07 "Encerramento ordenado"). */
  close(): Promise<void>;
}
