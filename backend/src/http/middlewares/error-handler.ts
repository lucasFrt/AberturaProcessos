import type { NextFunction, Request, Response } from 'express';

import { AppError } from '@/domain/errors/app-error';
import { logger } from '@/infra/logger';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Último middleware da cadeia. Converte AppError (e erros não previstos) no
 * envelope de erro padronizado descrito em docs/05-contrato-api.md.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura exigida pelo Express para reconhecer error handler
  _next: NextFunction,
): void {
  const requestId = req.headers['x-request-id'] as string | undefined;
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

  logger.error({ err: error, requestId }, 'Erro não tratado');

  const body: ErrorResponseBody = {
    error: { code: 'INTERNAL_ERROR', message: 'Erro interno.', ...requestIdField },
  };
  res.status(500).json(body);
}
