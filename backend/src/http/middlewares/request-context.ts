import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { ulid } from 'ulid';

import { logger } from '@/infra/logger';

/**
 * Dois middlewares combinados (docs/09-padroes-de-codigo-e-testes.md, seção Logs):
 * 1. `pino-http` gera um `requestId` (ULID) por requisição e cria um logger
 *    filho (`req.log`) já carregando esse id em todo log da requisição.
 * 2. Propaga o mesmo id no header `X-Request-Id` da resposta, para que o
 *    usuário possa referenciar um erro específico ao reportar um problema.
 *
 * `req.id` (preenchido pelo pino-http) é a fonte única lida pelo error-handler.
 */
export function requestContext(): RequestHandler[] {
  const httpLogger = pinoHttp({
    logger,
    genReqId: () => ulid(),
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });

  const propagateRequestIdHeader: RequestHandler = (req, res, next) => {
    // req.id é sempre string aqui: genReqId() acima retorna sempre um ULID.
    if (typeof req.id === 'string') {
      res.setHeader('X-Request-Id', req.id);
    }
    next();
  };

  return [httpLogger, propagateRequestIdHeader];
}
