import type { IlogSyncService, SyncLogger } from '@/services/ilog-sync-service';

export interface IlogSyncJobOptions {
  intervalMinutes: number;
  /** Atraso do primeiro ciclo depois da subida, para não competir com o boot. */
  initialDelayMs?: number | undefined;
}

/**
 * Agendador do espelho do iLog (docs/15, seção 5.2): um `setInterval` no
 * processo da API. Não é BullMQ de propósito — o job precisa do
 * `RealtimeProvider` anexado ao `http.Server` para o board receber
 * `process:created` do que for espelhado, e isso só existe aqui. Um único
 * processo da API roda em produção (NSSM, docs/11), então não há dois
 * agendadores concorrendo; `IlogSyncService.runOnce` ainda rejeita
 * sobreposição, por garantia.
 */
export class IlogSyncJob {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: IlogSyncService,
    private readonly logger: SyncLogger,
    private readonly options: IlogSyncJobOptions,
  ) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.options.intervalMinutes * 60_000;
    this.initialTimer = setTimeout(() => void this.tick(), this.options.initialDelayMs ?? 15_000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Timers não devem segurar o processo vivo sozinhos no shutdown.
    this.initialTimer.unref();
    this.timer.unref();
    this.logger.info({ intervalMinutes: this.options.intervalMinutes }, 'iLog: job agendado');
  }

  stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = null;
    this.timer = null;
  }

  /** Um ciclo; erros viram log (e `lastError` no estado), nunca derrubam a API. */
  async tick(): Promise<void> {
    try {
      await this.service.runOnce();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido.';
      this.logger.warn({ error: message }, 'iLog: ciclo falhou');
    }
  }
}
