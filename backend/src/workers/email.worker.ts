import type { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { Logger } from 'pino';

import type { Mailer } from '@/domain/mail/mailer';
import { EMAIL_JOBS } from '@/domain/queue/queue-provider';
import type { EmailJobData } from '@/domain/queue/queue-provider';
import { QUEUE_NAMES } from '@/infra/queue/queues';
import {
  renderProcessStageChangedEmail,
  renderUserPendingApprovalEmail,
} from '@/workers/email-templates';
import { resolveEmailRecipients } from '@/workers/resolve-email-recipients';

export interface EmailWorkerDeps {
  mailer: Mailer;
  prisma: PrismaClient;
  logger: Logger;
  frontendUrl: string;
}

/**
 * Envia o e-mail via `bcc` com um único endereço, para não expor a lista
 * interna de destinatários (docs/07). Lista vazia -> log `warn`, sem erro:
 * nada a enviar não é falha.
 */
async function sendToInternalRecipients(
  deps: EmailWorkerDeps,
  jobName: string,
  rendered: { subject: string; html: string; text: string },
): Promise<void> {
  const recipients = await resolveEmailRecipients(deps.prisma);

  if (recipients.length === 0) {
    deps.logger.warn({ job: jobName }, 'Nenhum destinatário interno ativo para o e-mail');
    return;
  }

  await deps.mailer.send({
    to: [],
    bcc: recipients,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

/** Processo separado (`src/workers/index.ts`), compartilhando Prisma/logger/env com a API. */
export function createEmailWorker(
  deps: EmailWorkerDeps,
  connection: ConnectionOptions,
): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(
    QUEUE_NAMES.EMAIL,
    async (job) => {
      switch (job.data.name) {
        case EMAIL_JOBS.PROCESS_STAGE_CHANGED: {
          const rendered = renderProcessStageChangedEmail(job.data.payload, deps.frontendUrl);
          return sendToInternalRecipients(deps, job.data.name, rendered);
        }
        case EMAIL_JOBS.USER_PENDING_APPROVAL: {
          const rendered = renderUserPendingApprovalEmail(job.data.payload, deps.frontendUrl);
          return sendToInternalRecipients(deps, job.data.name, rendered);
        }
        default: {
          throw new Error(`Job desconhecido: ${(job.data as { name: string }).name}`);
        }
      }
    },
    { connection, concurrency: 5 },
  );

  worker.on('failed', (job, error) => {
    deps.logger.error(
      { jobId: job?.id, jobName: job?.name, attemptsMade: job?.attemptsMade, err: error },
      'Falha ao processar job de e-mail',
    );
  });

  worker.on('completed', (job) => {
    deps.logger.debug({ jobId: job.id, jobName: job.name }, 'Job de e-mail concluído');
  });

  worker.on('error', (error) => {
    deps.logger.error({ err: error }, 'Erro no worker de e-mail');
  });

  return worker;
}
