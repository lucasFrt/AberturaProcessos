import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { Role } from '@/domain/enums';
import { ForbiddenError, UnauthenticatedError } from '@/domain/errors/app-error';

/**
 * Guard por papel (docs/06, seção "Autorização", camada 1). Deve vir
 * sempre depois de `authenticate` na cadeia de middlewares. Não substitui
 * o escopo por recurso aplicado na camada de repositório — as duas camadas
 * são obrigatórias.
 */
export function authorize(...allowedRoles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(new UnauthenticatedError());
      return;
    }

    if (!allowedRoles.includes(req.auth.role)) {
      next(new ForbiddenError('FORBIDDEN', 'Você não tem permissão para executar esta ação.'));
      return;
    }

    next();
  };
}
