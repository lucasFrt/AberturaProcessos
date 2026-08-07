import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError, UnauthenticatedError } from '@/domain/errors/app-error';
import type { UserRepository } from '@/domain/repositories/user-repository';
import type { TokenService } from '@/infra/security/token-service';
import type { AccessScopeResolver } from '@/services/access-scope-resolver';

const BEARER_PREFIX = 'Bearer ';

export interface AuthenticateDeps {
  tokenService: TokenService;
  userRepository: UserRepository;
  accessScopeResolver: AccessScopeResolver;
}

/**
 * Valida o access token e popula `req.auth` (docs/06, seção "Middleware de
 * autenticação"). O status do usuário é revalidado no banco a cada
 * requisição, para que desativar uma conta corte o acesso quase de
 * imediato, sem depender da expiração do token.
 */
export function authenticate(deps: AuthenticateDeps): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    void handle(deps, req, next);
  };
}

async function handle(deps: AuthenticateDeps, req: Request, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new UnauthenticatedError();
    }

    const token = header.slice(BEARER_PREFIX.length);
    const payload = deps.tokenService.verifyAccessToken(token);

    const user = await deps.userRepository.findById(payload.sub);
    if (!user) {
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
