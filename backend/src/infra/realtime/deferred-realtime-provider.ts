import type {
  ProcessEventTarget,
  ProcessRealtimeEvent,
  RealtimeProvider,
} from '@/domain/realtime/realtime-provider';

/**
 * Desvio deliberado do padrão de `QueueProvider` (docs/07), documentado
 * aqui: `BullMqQueueProvider` pode ser instanciado dentro de
 * `buildContainer` porque só precisa da conexão Redis, disponível desde o
 * início. `SocketIoProvider` precisa do `http.Server`, que só existe
 * DEPOIS de `app.listen()` — ou seja, depois que `createApp`/
 * `buildContainer` já terminaram e os services já foram construídos com
 * suas dependências por injeção de construtor.
 *
 * Em vez de reestruturar os services para receber o provider tardiamente
 * (o que quebraria o padrão de composição único em `container.ts`),
 * `DeferredRealtimeProvider` é injetado nos services como se fosse o
 * provider real — ele apenas encaminha cada chamada para um delegate
 * interno, que começa como um no-op e é substituído pelo `SocketIoProvider`
 * de verdade assim que `http/server.ts` obtém o `http.Server` (via
 * `attach`). Em testes de integração (`buildTestApp`), nenhum socket é
 * anexado — o delegate permanece no-op, exatamente como um `RealtimeProvider`
 * fake/noop injetado deliberadamente (ver instruções da Tarefa 13).
 */
export class DeferredRealtimeProvider implements RealtimeProvider {
  private delegate: RealtimeProvider = new NoopRealtimeProvider();

  /** Chamado por `http/server.ts` assim que o `SocketIoProvider` real existe. */
  attach(provider: RealtimeProvider): void {
    this.delegate = provider;
  }

  emitProcessEvent(event: ProcessRealtimeEvent, target: ProcessEventTarget): void {
    this.delegate.emitProcessEvent(event, target);
  }

  emitStagesChanged(): void {
    this.delegate.emitStagesChanged();
  }

  async close(): Promise<void> {
    await this.delegate.close();
  }
}

/** Delegate inicial: nenhuma emissão real até `attach` ser chamado. */
export class NoopRealtimeProvider implements RealtimeProvider {
  emitProcessEvent(): void {
    // Sem servidor Socket.IO anexado ainda (ou em testes) — não há o que emitir.
  }

  emitStagesChanged(): void {
    // Idem.
  }

  async close(): Promise<void> {
    // Nada a fechar.
  }
}
