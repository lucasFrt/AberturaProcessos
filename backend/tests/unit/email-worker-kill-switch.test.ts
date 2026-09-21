import type { Mailer, MailMessage } from '@/domain/mail/mailer';
import { createEmailWorker } from '@/workers/email.worker';

/**
 * `EMAIL_NOTIFICATIONS_ENABLED=false` (docs/07; docs/13): o worker consome o
 * job sem enviar. O processor é privado ao módulo, então o teste o alcança
 * por um dublê de `Worker` (jest.mock é içado acima dos imports) — sem Redis.
 */
jest.mock('bullmq', () => ({
  Worker: class {
    constructor(
      _name: string,
      readonly processor: (job: unknown) => Promise<void>,
    ) {}
    on(): void {}
  },
}));

class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

const silentLogger = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
} as unknown as import('pino').Logger;

const prismaWithRecipients = {
  user: {
    findMany: (): Promise<{ email: string }[]> => Promise.resolve([{ email: 'ops@opusce.com.br' }]),
  },
} as unknown as import('@prisma/client').PrismaClient;

const stageJob = {
  data: {
    name: 'process-stage-changed',
    payload: {
      processId: 'p1',
      processCode: 'PRC-2026-00001',
      reference: 'REF',
      clientCompanyName: 'Cliente',
      clientCompanyCnpj: '11222333000181',
      fromStageName: 'Entrada',
      toStageName: 'Em andamento',
      actorName: 'Ana',
      note: null,
      occurredAt: new Date().toISOString(),
    },
  },
};

describe('email worker — EMAIL_NOTIFICATIONS_ENABLED', () => {
  it('com a chave desligada, consome o job sem chamar o mailer', async () => {
    const mailer = new FakeMailer();
    const worker = createEmailWorker(
      {
        mailer,
        prisma: prismaWithRecipients,
        logger: silentLogger,
        frontendUrl: 'http://front',
        notificationsEnabled: false,
      },
      {},
    ) as unknown as { processor: (job: unknown) => Promise<void> };
    await worker.processor(stageJob);
    expect(mailer.sent).toHaveLength(0);
  });

  it('com a chave ligada, envia por bcc aos internos ativos', async () => {
    const mailer = new FakeMailer();
    const worker = createEmailWorker(
      {
        mailer,
        prisma: prismaWithRecipients,
        logger: silentLogger,
        frontendUrl: 'http://front',
        notificationsEnabled: true,
      },
      {},
    ) as unknown as { processor: (job: unknown) => Promise<void> };
    await worker.processor(stageJob);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.bcc).toEqual(['ops@opusce.com.br']);
  });
});
