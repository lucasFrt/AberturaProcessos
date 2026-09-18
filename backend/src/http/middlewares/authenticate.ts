import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { User } from '@/domain/entities/user';
import { AppError, UnauthenticatedError } from '@/domain/errors/app-error';
import type { ApiKeyRepository } from '@/domain/repositories/api-key-repository';
import type { UserRepository } from '@/domain/repositories/user-repository';
import { hashApiKey } from '@/infra/security/api-key-generator';
import type { TokenService } from '@/infra/security/token-service';
import type { AccessScopeResolver } from '@/services/access-scope-resolver';

const BEARER_PREFIX = 'Bearer ';
export const API_KEY_HEADER = 'x-api-key';

export interface AuthenticateDeps {
  tokenService: TokenService;
  userRepository: UserRepository;
  accessScopeResolver: AccessScopeResolver;
  apiKeyRepository: ApiKeyRepository;
}

/**
 * Valida a credencial e popula `req.auth` (docs/06, seção "Middleware de
 * autenticação"). Duas credenciais são aceitas, com o mesmo resultado:
 *
 * - `Authorization: Bearer <jwt>` — sessão de pessoa (docs/06);
 * - `X-Api-Key: <chave>` — conta de serviço (docs/13, decisão 2). A chave
 *   resolve para o usuário interno vinculado, e daí em diante nada muda:
 *   status, escopo, `authorize` e rate limit são os desse usuário.
 *
 * O status do usuário é revalidado no banco a cada requisição, para que
 * desativar uma conta (ou revogar uma chave) corte o acesso quase de
 * imediato, sem depender da expiração do token.
 */
export function authenticate(deps: AuthenticateDeps): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    void handle(deps, req, next);
  };
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function resolveUserFromApiKey(
  deps: AuthenticateDeps,
  plainKey: string,
): Promise<{ user: User; apiKeyId: string }> {
  const apiKey = await deps.apiKeyRepository.findByKeyHash(hashApiKey(plainKey));
  if (!apiKey || apiKey.revokedAt) {
    throw new UnauthenticatedError();
  }
  const user = await deps.userRepository.findById(apiKey.userId);
  if (!user) {
    throw new UnauthenticatedError();
  }
  // Fire-and-forget: registrar o uso não pode atrasar nem falhar a requisição.
  void deps.apiKeyRepository.touchLastUsed(apiKey.id, new Date()).catch(() => undefined);
  return { user, apiKeyId: apiKey.id };
}

async function resolveUserFromBearer(deps: AuthenticateDeps, token: string): Promise<User> {
  const payload = deps.tokenService.verifyAccessToken(token);
  const user = await deps.userRepository.findById(payload.sub);
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
}

async function handle(deps: AuthenticateDeps, req: Request, next: NextFunction): Promise<void> {
  try {
    const apiKeyHeader = headerValue(req, API_KEY_HEADER)?.trim();
    const authorization = headerValue(req, 'authorization');

    let user: User;
    let apiKeyId: string | null = null;

    if (apiKeyHeader) {
      ({ user, apiKeyId } = await resolveUserFromApiKey(deps, apiKeyHeader));
    } else if (authorization?.startsWith(BEARER_PREFIX)) {
      user = await resolveUserFromBearer(deps, authorization.slice(BEARER_PREFIX.length));
    } else {
      throw new UnauthenticatedError();
    }

    if (user.status === 'PENDING') {
      throw new AppError('ACCOUNT_PENDING', 'Conta aguardando aprovação de um administrador.', 403);
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_DISABLED', 'Conta desativada.', 403);
    }

    const scope = await deps.accessScopeResolver.resolve(user);

    req.auth = {
      userId: user.id,
      role: user.role,
      organizationId: user.organizationId,
      scope,
      authKind: apiKeyId ? 'API_KEY' : 'JWT',
      apiKeyId,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    // Erros do jsonwebtoken (expirado, assinatura inválida, etc.) caem aqui.
    next(new UnauthenticatedError());
  }
}
