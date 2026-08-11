import type { Server as HttpServer } from 'http';

import { Server as SocketIoServer } from 'socket.io';
import type { Socket } from 'socket.io';

import type { AccessScope } from '@/domain/entities/access-scope';
import type { Role } from '@/domain/enums';
import type {
  ProcessEventTarget,
  ProcessRealtimeEvent,
  RealtimeProvider,
} from '@/domain/realtime/realtime-provider';
import type { UserRepository } from '@/domain/repositories/user-repository';
import type { TokenService } from '@/infra/security/token-service';
import type { AccessScopeResolver } from '@/services/access-scope-resolver';

export const INTERNAL_ROOM = 'role:internal';

export function companyRoom(companyId: string): string {
  return `company:${companyId}`;
}

export interface SocketAuthData {
  userId: string;
  role: Role;
  scope: AccessScope;
}

/** `socket.data` tipado via generics do Socket.IO (docs/07, handshake). */
interface SocketData {
  auth?: SocketAuthData;
}

/**
 * Eventos emitidos pelo servidor (docs/05, tabela "Eventos WebSocket").
 * `ProcessRealtimeEvent['name']` mantém esta lista sincronizada com o
 * union de eventos de processo do domínio; `stages:changed` é adicionado
 * manualmente por não fazer parte daquele union (não carrega payload
 * nem alvo de sala — ver `RealtimeProvider.emitStagesChanged`).
 */
interface ServerToClientEvents {
  'process:created': (payload: { process: unknown }) => void;
  'process:moved': (payload: unknown) => void;
  'process:updated': (payload: { processId: string }) => void;
  'process:deleted': (payload: { processId: string }) => void;
  'stages:changed': (payload: Record<string, never>) => void;
}

type AppSocket = Socket<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface SocketIoProviderDeps {
  tokenService: TokenService;
  userRepository: UserRepository;
  accessScopeResolver: AccessScopeResolver;
}

/**
 * Resolve as salas de entrada de um socket autenticado (docs/07, seção
 * "Salas"): `role:internal` para OPERATIONAL/ADMIN, ou uma sala por CNPJ
 * do escopo resolvido para CLIENT.
 */
export function resolveJoinRooms(auth: SocketAuthData): string[] {
  if (auth.role === 'OPERATIONAL' || auth.role === 'ADMIN') {
    return [INTERNAL_ROOM];
  }
  if (auth.scope.kind === 'ALL') {
    // Não deveria ocorrer para CLIENT (docs/06: CLIENT sempre resolve para
    // COMPANIES), mas cobre o caso defensivamente sem lançar.
    return [];
  }
  return auth.scope.companyIds.map(companyRoom);
}

/**
 * Resolve as salas de destino de um evento de processo (docs/07): sempre
 * `role:internal` + a sala do CNPJ cliente, e também a do CNPJ
 * solicitante quando houver. Socket.IO deduplica destinatários entre
 * salas nativamente — um usuário com acesso aos dois CNPJs recebe o
 * evento uma única vez.
 */
export function resolveProcessEventRooms(target: ProcessEventTarget): string[] {
  const rooms = new Set([INTERNAL_ROOM, companyRoom(target.clientCompanyId)]);
  if (target.requestingCompanyId) {
    rooms.add(companyRoom(target.requestingCompanyId));
  }
  return [...rooms];
}

/**
 * Valida o token do handshake e resolve `{ userId, role, scope }` (docs/07,
 * seção "Handshake autenticado"). Extraída como função pura para ser
 * testável sem precisar montar um servidor Socket.IO real — mesma lógica
 * de verificação usada pelo middleware `authenticate` HTTP
 * (`TokenService.verifyAccessToken` + `UserRepository.findById` +
 * `AccessScopeResolver.resolve`), sem duplicação.
 *
 * Lança `Error('UNAUTHENTICATED')` para token ausente/inválido/usuário
 * inexistente, e `Error('ACCOUNT_DISABLED')` para usuário com
 * `status !== 'ACTIVE'`.
 */
export async function authenticateSocketToken(
  deps: SocketIoProviderDeps,
  token: string | undefined,
): Promise<SocketAuthData> {
  if (!token) {
    throw new Error('UNAUTHENTICATED');
  }

  let payload;
  try {
    payload = deps.tokenService.verifyAccessToken(token);
  } catch {
    throw new Error('UNAUTHENTICATED');
  }

  const user = await deps.userRepository.findById(payload.sub);
  if (!user) {
    throw new Error('UNAUTHENTICATED');
  }
  if (user.status !== 'ACTIVE') {
    throw new Error('ACCOUNT_DISABLED');
  }

  const scope = await deps.accessScopeResolver.resolve(user);
  return { userId: user.id, role: user.role, scope };
}

/**
 * Implementação real de `RealtimeProvider` sobre Socket.IO (docs/07),
 * anexada ao mesmo `http.Server` do Express. O handshake autenticado
 * reaproveita `TokenService`/`AccessScopeResolver`/`UserRepository` já
 * existentes — a mesma lógica de `authenticate` (middleware HTTP), sem
 * duplicação.
 */
export class SocketIoProvider implements RealtimeProvider {
  readonly io: SocketIoServer<
    Record<string, never>,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >;

  constructor(
    httpServer: HttpServer,
    private readonly deps: SocketIoProviderDeps,
  ) {
    this.io = new SocketIoServer(httpServer, {
      cors: { origin: false },
    });

    this.io.use((socket, next) => {
      void this.authenticateHandshake(socket, next);
    });

    this.io.on('connection', (socket) => {
      const auth = socket.data.auth;
      if (!auth) return;
      for (const room of resolveJoinRooms(auth)) {
        void socket.join(room);
      }
    });
  }

  private async authenticateHandshake(
    socket: AppSocket,
    next: (err?: Error) => void,
  ): Promise<void> {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      const auth = await authenticateSocketToken(this.deps, token);
      socket.data.auth = auth;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('UNAUTHENTICATED'));
    }
  }

  emitProcessEvent(event: ProcessRealtimeEvent, target: ProcessEventTarget): void {
    const rooms = resolveProcessEventRooms(target);
    this.io.to(rooms).emit(event.name, event.payload);
  }

  emitStagesChanged(): void {
    // Etapas são globais (docs/02 RF-33) — alcança todos os sockets
    // conectados, sem restrição de sala.
    this.io.emit('stages:changed', {});
  }

  /**
   * `io.close()` aceita um callback disparado quando todas as conexões
   * terminam — encapsulado em Promise para compor com o `await` do
   * encerramento ordenado em `http/server.ts` (RNF-12; docs/07 seção
   * "Encerramento ordenado": `io.close()` sempre ANTES de fechar o
   * servidor HTTP).
   */
  async close(): Promise<void> {
    await this.io.close();
  }
}
