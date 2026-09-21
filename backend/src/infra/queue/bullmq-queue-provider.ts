import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { Logger } from 'pino';

import type { EmailJobData, QueueProvider } from '@/domain/queue/queue-provider';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, QUEUE_PREFIX } from '@/infra/queue/queues';

/**
 * Implementação real de `QueueProvider` sobre BullMQ (docs/07). Reaproveita
 * `redisConnectionOptions` de `infra/queue/connection.ts` — mesma conexão do
 * health check, mesma configuração exigida pelo BullMQ
 * (`maxRetriesPerRequest: null`).
 */
export class BullMqQueueProvider implements QueueProvider {
  private readonly queue: Queue<EmailJobData>;

  constructor(
    connection: ConnectionOptions,
    private readonly logger: Logger,
  ) {
    this.queue = new Queue<EmailJobData>(QUEUE_NAMES.EMAIL, { connection, prefix: QUEUE_PREFIX });
  }

  async enqueueEmail(job: EmailJobData): Promise<void> {
    try {
      await this.queue.add(job.name, job, DEFAULT_JOB_OPTIONS);
    } catch (error) {
      // RF-51: indisponibilidade do Redis não derruba a requisição HTTP.
      // A decisão de engolir o erro é deliberada e vale só para
      // notificação: perder um e-mail é aceitável, perder a movimentação
      // do processo não é. O log em nível error garante visibilidade.
      this.logger.error({ err: error, job: job.name }, 'Falha ao enfileirar e-mail');
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
