# 07 - Filas, Notificações e Tempo Real

## Redis

Serve BullMQ (filas) e, se necessário no futuro, o adapter do Socket.IO e o store do rate limit.
Roda em container Docker, tanto em desenvolvimento quanto em produção no Windows Server.

BullMQ exige `maxRetriesPerRequest: null` na conexão do worker — sem isso o ioredis aborta comandos
bloqueantes durante reconexões:

```ts
// infra/queue/connection.ts
export const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};
```

## Filas

Uma fila no v1: `email`. Nomes e payloads tipados em um único arquivo, para que produtor e consumidor
não possam divergir.

```ts
// infra/queue/queues.ts
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
  note?: string;
  occurredAt: string; // ISO
}

export interface UserPendingApprovalPayload {
  userId: string;
  userName: string;
  userEmail: string;
  provider: AuthProvider;
  occurredAt: string;
}

export type EmailJobData =
  | { name: typeof EMAIL_JOBS.PROCESS_STAGE_CHANGED; payload: ProcessStageChangedPayload }
  | { name: typeof EMAIL_JOBS.USER_PENDING_APPROVAL; payload: UserPendingApprovalPayload };
```

Opções padrão dos jobs:

```ts
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },  // 5s, 10s, 20s, 40s, 80s
  removeOnComplete: { age: 86_400, count: 1_000 }, // mantém 1 dia para inspeção
  removeOnFail: { age: 604_800 },                  // falhas ficam 7 dias
};
```

## Provider de fila (interface)

O service não conhece BullMQ. Isso permite testar regra de negócio com um fake que apenas registra as
chamadas, e trocar a implementação sem tocar em domínio.

```ts
// infra/queue/queue-provider.ts
export interface QueueProvider {
  enqueueEmail(job: EmailJobData): Promise<void>;
  close(): Promise<void>;
}
```

```ts
// infra/queue/bullmq-queue-provider.ts
export class BullMqQueueProvider implements QueueProvider {
  private readonly queue: Queue<EmailJobData>;

  constructor(connection: ConnectionOptions, private readonly logger: Logger) {
    this.queue = new Queue<EmailJobData>(QUEUE_NAMES.EMAIL, { connection });
  }

  async enqueueEmail(job: EmailJobData): Promise<void> {
    try {
      await this.queue.add(job.name, job, DEFAULT_JOB_OPTIONS);
    } catch (error) {
      // RF-51: indisponibilidade do Redis não derruba a requisição HTTP
      this.logger.error({ err: error, job: job.name }, 'Falha ao enfileirar e-mail');
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
```

A decisão de engolir o erro é deliberada e vale só para notificação: perder um e-mail é aceitável,
perder a movimentação do processo não é. O log em nível `error` garante visibilidade.

## Worker

Processo separado (`src/workers/index.ts`), registrado como segundo serviço no NSSM. Compartilha
config, logger e Prisma com a API, mas não abre porta HTTP.

```ts
// workers/email.worker.ts
export function createEmailWorker(deps: { mailer: Mailer; prisma: PrismaClient; logger: Logger }) {
  return new Worker<EmailJobData>(
    QUEUE_NAMES.EMAIL,
    async (job) => {
      switch (job.data.name) {
        case EMAIL_JOBS.PROCESS_STAGE_CHANGED:
          return sendStageChangedEmail(deps, job.data.payload);
        case EMAIL_JOBS.USER_PENDING_APPROVAL:
          return sendPendingApprovalEmail(deps, job.data.payload);
        default:
          throw new Error(`Job desconhecido: ${(job.data as { name: string }).name}`);
      }
    },
    { connection: redisConnection, concurrency: 5 },
  );
}
```

Eventos monitorados: `failed` (log `error` com tentativa e motivo), `completed` (log `debug`),
`error` (log `error`). No `SIGTERM`, `await worker.close()` para deixar o job em andamento terminar
antes de encerrar.

### Resolução dos destinatários

A lista de destinatários é montada **no worker**, não no produtor. Assim o payload não carrega
e-mails, e a lista reflete o estado no momento do envio:

```sql
SELECT email, name FROM users
WHERE status = 'ACTIVE' AND role IN ('OPERATIONAL', 'ADMIN')
```

Se a lista vier vazia, o job termina com log `warn` e sem erro (nada a enviar não é falha).
O envio usa `bcc` com um único e-mail, para não expor a lista interna de endereços.

## E-mail

Nodemailer atrás de interface:

```ts
export interface Mailer {
  send(message: { to: string[]; bcc?: string[]; subject: string; html: string; text: string }): Promise<void>;
}
```

Em desenvolvimento, `SMTP_HOST` apontando para Mailpit (`localhost:1025`, incluído no
`docker-compose.yml`) ou Ethereal. Nenhum e-mail sai para fora em dev.

### Template: mudança de etapa (RF-50)

Assunto:

```
[PRC-2026-00042] Entrada → Em Andamento — Cliente X Matriz LTDA
```

Corpo (HTML simples e inline, sem framework de template — legível em qualquer cliente de e-mail),
contendo:

- Código e referência do processo.
- CNPJ e razão social do cliente.
- Etapa de origem → etapa de destino.
- Quem movimentou e quando (formatado em `America/Sao_Paulo`).
- A observação (`note`), se informada.
- Link direto: `{FRONTEND_URL}/processes/{processId}`.

Versão `text` sempre presente junto da `html`, para acessibilidade e para não cair em filtro de spam.

## Tempo real (Socket.IO)

Servidor Socket.IO anexado ao mesmo `http.Server` do Express.

### Handshake autenticado

```ts
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('UNAUTHENTICATED'));

    const payload = tokenService.verifyAccessToken(token);
    const user = await scopeResolver.load(payload.sub);
    if (user.status !== 'ACTIVE') return next(new Error('ACCOUNT_DISABLED'));

    socket.data.auth = { userId: user.id, role: user.role, scope: user.scope };
    next();
  } catch {
    next(new Error('UNAUTHENTICATED'));
  }
});
```

O front envia o token em `auth.token` no `io(url, { auth: { token } })` e, ao renovar o access token,
atualiza `socket.auth` e reconecta. Token expirado gera `connect_error` com `UNAUTHENTICATED`, e o
cliente tenta o refresh antes de reconectar.

### Salas

```
role:internal          -> todos os OPERATIONAL e ADMIN
company:<companyId>    -> uma sala por CNPJ acessível ao usuário
```

No `connection`, o socket entra em `role:internal` (se interno) ou em uma sala por CNPJ do escopo.
Emitir para os CNPJs do processo cobre exatamente quem pode vê-lo, incluindo o caso trading em que o
`requestingCompany` difere do `clientCompany`.

```ts
// infra/realtime/socket-io-provider.ts
emitProcessEvent(event: RealtimeEvent, target: { clientCompanyId: string; requestingCompanyId: string | null }) {
  const rooms = ['role:internal', `company:${target.clientCompanyId}`];
  if (target.requestingCompanyId) rooms.push(`company:${target.requestingCompanyId}`);
  this.io.to(rooms).emit(event.name, event.payload);
}
```

Socket.IO deduplica destinatários entre salas, então um usuário com acesso aos dois CNPJs recebe o
evento uma única vez.

### Eventos

Ver a tabela em [05-contrato-api.md](./05-contrato-api.md#eventos-websocket). Os payloads são
enxutos de propósito: o cliente usa o evento como gatilho de invalidação no TanStack Query e refaz a
busca já sob suas próprias regras de escopo. Isso evita que um payload gordo se torne um segundo
caminho de vazamento de dados.

Exceção: `process:moved` carrega `fromStageId`/`toStageId` para permitir uma atualização otimista da
posição do card antes do refetch, o que remove o "salto" visual no board.

### Emissão pós-commit

Eventos são emitidos **depois** do commit da transação. Emitir antes cria a corrida clássica: o
outro cliente recebe o aviso, refaz a busca e ainda lê o estado antigo.

```ts
const result = await this.processRepository.transaction(async (tx) => { /* update + history */ });
await this.queue.enqueueEmail({ name: EMAIL_JOBS.PROCESS_STAGE_CHANGED, payload });
this.realtime.emitProcessEvent({ name: 'process:moved', payload }, target);
return result;
```

### Escala e IIS

Uma única instância Node no v1, então o adapter em memória basta. Se houver mais de uma instância,
adicionar `@socket.io/redis-adapter` sobre o Redis existente — nenhuma mudança de código de domínio,
só a configuração do gateway.

No IIS, o proxy precisa permitir upgrade de WebSocket (feature "WebSocket Protocol" instalada). Se
não for possível, o Socket.IO cai para long-polling automaticamente e o sistema continua funcional,
com latência maior. Ver [11-deploy-windows-server.md](./11-deploy-windows-server.md).

## Encerramento ordenado (RNF-12)

```ts
async function shutdown(signal: string) {
  logger.info({ signal }, 'Encerrando');
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await queueProvider.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

O worker faz o mesmo com `worker.close()`, que espera o job corrente terminar. Sem isso, um restart
pelo NSSM pode interromper um job no meio e duplicar o e-mail na retentativa.
