import type { JobsOptions } from 'bullmq';

import { env } from '@/config/env';

/**
 * Nomes de fila/job e payloads tipados vivem em `domain/queue/queue-provider.ts`
 * (services precisam importá-los sem tocar em `infra/queue`). Este arquivo
 * reexporta o necessário e acrescenta o que é exclusivo de infraestrutura
 * (`DEFAULT_JOB_OPTIONS`, que depende do tipo `JobsOptions` do BullMQ).
 */
export {
  QUEUE_NAMES,
  EMAIL_JOBS,
  type EmailJobData,
  type ProcessStageChangedPayload,
  type UserPendingApprovalPayload,
} from '@/domain/queue/queue-provider';

/**
 * Opções padrão dos jobs de e-mail (docs/07). Backoff exponencial de 5s a
 * 80s ao longo de 5 tentativas; falhas ficam 7 dias para inspeção manual,
 * sucessos só 1 dia.
 */
/**
 * Prefixo de todas as chaves do BullMQ (`<prefixo>:email:*`). Configurável
 * porque em produção o Redis é compartilhado com outra aplicação que também
 * tem uma fila chamada `email` (docs/10) — produtor e worker precisam usar
 * o MESMO prefixo, por isso ele sai daqui e não de cada `new Queue`.
 */
export const QUEUE_PREFIX = env.REDIS_KEY_PREFIX;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 }, // 5s, 10s, 20s, 40s, 80s
  removeOnComplete: { age: 86_400, count: 1_000 }, // mantém 1 dia para inspeção
  removeOnFail: { age: 604_800 }, // falhas ficam 7 dias
};
