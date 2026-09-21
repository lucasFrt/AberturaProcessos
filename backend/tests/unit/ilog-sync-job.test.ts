import { IlogSyncJob } from '@/jobs/ilog-sync-job';
import type { IlogSyncService } from '@/services/ilog-sync-service';

function fakeService(runOnce: () => Promise<unknown>): IlogSyncService {
  // Só `runOnce` é usado pelo job; o resto do service não entra aqui.
  return { runOnce } as unknown as IlogSyncService;
}

describe('IlogSyncJob (docs/15, seção 5.2)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('roda um ciclo depois do atraso inicial e depois a cada intervalo; stop() para', async () => {
    const runOnce = jest.fn(() => Promise.resolve({}));
    const job = new IlogSyncJob(
      fakeService(runOnce),
      { info: jest.fn(), warn: jest.fn() },
      {
        intervalMinutes: 5,
        initialDelayMs: 1000,
      },
    );

    job.start();
    job.start(); // idempotente
    expect(runOnce).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(runOnce).toHaveBeenCalledTimes(2);

    job.stop();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it('um ciclo que falha vira aviso no log e não interrompe os próximos', async () => {
    const runOnce = jest
      .fn<Promise<unknown>, []>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({});
    const warn = jest.fn();
    const job = new IlogSyncJob(
      fakeService(runOnce),
      { info: jest.fn(), warn },
      {
        intervalMinutes: 1,
        initialDelayMs: 0,
      },
    );

    job.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith({ error: 'ECONNREFUSED' }, 'iLog: ciclo falhou');

    await jest.advanceTimersByTimeAsync(60_000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    job.stop();
  });
});
