import type { AuthProvider } from '@/domain/enums';

/**
 * Fila de e-mail assíncrona (RF-50 a RF-52; docs/07-filas-notificacoes-realtime.md).
 * Vive no domínio — não em `infra/queue` — pelo mesmo motivo de
 * `domain/storage/storage-provider.ts`: `ProcessService`/`UserManagementService`
 * (camada de serviço) precisam depender só da interface e dos payloads
 * tipados, nunca do BullMQ. `no-restricted-imports` (eslint.config.js)
 * bloqueia `src/services/**` e `src/domain/**` de importar `@/infra/queue/*`.
 */
export const QUEUE_NAMES = { EMAIL: 'email' } as const;

export const EMAIL_JOBS = {
  PROCESS_STAGE_CHANGED: 'process-stage-changed',
  USER_PENDING_APPROVAL: 'user-pending-approval',
} as const;

export interface ProcessStageChangedPayload {
  processId: string;
  processCode: string;
  reference: string;
  clientCompanyName: string;
  clientCompanyCnpj: string;
  fromStageName: string | null;
  toStageName: string;
  actorName: string;
  note?: string | null | undefined;
  occurredAt: string; // ISO
}

export interface UserPendingApprovalPayload {
  userId: string;
  userName: string;
  userEmail: string;
  provider: AuthProvider;
  occurredAt: string; // ISO
}

export type EmailJobData =
  | { name: typeof EMAIL_JOBS.PROCESS_STAGE_CHANGED; payload: ProcessStageChangedPayload }
  | { name: typeof EMAIL_JOBS.USER_PENDING_APPROVAL; payload: UserPendingApprovalPayload };

/**
 * O service não conhece BullMQ. Isso permite testar regra de negócio com um
 * fake que apenas registra as chamadas (docs/07), e trocar a implementação
 * sem tocar em domínio.
 */
export interface QueueProvider {
  /**
   * RF-51: indisponibilidade do Redis nunca deve propagar erro para quem
   * chama — a implementação real (`BullMqQueueProvider`) engole o erro com
   * log `error`. Perder um e-mail é aceitável; perder a movimentação do
   * processo não é.
   */
  enqueueEmail(job: EmailJobData): Promise<void>;
  close(): Promise<void>;
}
