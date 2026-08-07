import type { NextFunction, Request, Response } from 'express';

import { AppError, NotFoundError } from '@/domain/errors/app-error';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

function getRequestId(req: Request): string | undefined {
  // req.id (pino-http) é tipado como number | string | object, mas nesta
  // aplicação sempre é o ULID de string gerado em request-context.ts.
  return typeof req.id === 'string' ? req.id : undefined;
}

/**
 * Último middleware da cadeia. Converte AppError (e erros não previstos) no
 * envelope de erro padronizado descrito em docs/05-contrato-api.md.
 *
 * O log do erro em si é responsabilidade do `pino-http` (request-context.ts),
 * que já classifica >=500 como `error` e inclui o `req.id` automaticamente —
 * duplicar o log aqui produziria duas entradas para o mesmo evento.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura exigida pelo Express para reconhecer error handler
  _next: NextFunction,
): void {
  const requestId = getRequestId(req);
  const requestIdField = requestId ? { requestId } : {};

  if (error instanceof AppError) {
    const body: ErrorResponseBody = {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        ...requestIdField,
      },
    };
    res.status(error.status).json(body);
    return;
  }

  req.log?.error({ err: error }, 'Erro não tratado');

  const body: ErrorResponseBody = {
    error: { code: 'INTERNAL_ERROR', message: 'Erro interno.', ...requestIdField },
  };
  res.status(500).json(body);
}

/**
 * Rota inexistente: mesmo envelope de erro do resto da API, em vez do HTML
 * padrão do Express. Registrado como último handler antes do errorHandler.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError('NOT_FOUND', `Rota não encontrada: ${req.method} ${req.originalUrl}`));
}
