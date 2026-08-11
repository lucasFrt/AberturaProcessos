import type { EmailJobData, QueueProvider } from '@/domain/queue/queue-provider';

/**
 * Fake em memória de QueueProvider (docs/07: "isso permite testar regra de
 * negócio com um fake que apenas registra as chamadas"). `shouldFailEnqueue`
 * simula indisponibilidade do Redis para provar RF-51 — a Promise rejeita,
 * e quem chama (`ProcessService`/`AuthService`/`SocialAuthService`) precisa
 * capturar/ignorar o erro sem propagar para a resposta HTTP.
 */
export class FakeQueueProvider implements QueueProvider {
  readonly enqueuedJobs: EmailJobData[] = [];
  shouldFailEnqueue = false;
  closed = false;

  async enqueueEmail(job: EmailJobData): Promise<void> {
    if (this.shouldFailEnqueue) {
      throw new Error('Falha simulada ao enfileirar e-mail (Redis indisponível).');
    }
    this.enqueuedJobs.push(job);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
