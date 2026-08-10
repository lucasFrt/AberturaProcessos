import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '@/domain/errors/app-error';

interface ValidateSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Valida body/query/params com Zod antes do controller (docs/03, camada
 * Middlewares). Em caso de falha, lança ValidationError com os detalhes
 * por campo no formato do envelope de erro (docs/05).
 */
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        next(new ValidationError('Dados inválidos.', result.error.issues));
        return;
      }
      req.body = result.data;
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        next(new ValidationError('Parâmetros de consulta inválidos.', result.error.issues));
        return;
      }
      // Express 5 define `req.query` como getter sem setter (baseado em
      // `req.url`) — atribuição direta (`req.query = ...`) lança
      // "Cannot set property query". `defineProperty` sobrescreve o
      // acessor por uma propriedade de dados própria da instância.
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
      });
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        next(new ValidationError('Parâmetros de rota inválidos.', result.error.issues));
        return;
      }
      req.params = result.data as typeof req.params;
    }

    next();
  };
}
