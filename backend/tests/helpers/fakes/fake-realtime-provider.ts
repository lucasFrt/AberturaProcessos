import type {
  ProcessEventTarget,
  ProcessRealtimeEvent,
  RealtimeProvider,
} from '@/domain/realtime/realtime-provider';

/**
 * Fake em memória de RealtimeProvider (docs/07: "isso permite testar
 * regra de negócio com um fake que apenas registra as chamadas"), mesmo
 * espírito de `FakeQueueProvider`. Cada emissão registra um timestamp de
 * sequência (`calls.length` no momento da chamada) para permitir provar
 * ordem relativa em relação à persistência sem depender de `Date.now()`.
 */
export class FakeRealtimeProvider implements RealtimeProvider {
  readonly processEvents: { event: ProcessRealtimeEvent; target: ProcessEventTarget }[] = [];
  stagesChangedCount = 0;
  closed = false;

  emitProcessEvent(event: ProcessRealtimeEvent, target: ProcessEventTarget): void {
    this.processEvents.push({ event, target });
  }

  emitStagesChanged(): void {
    this.stagesChangedCount += 1;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
