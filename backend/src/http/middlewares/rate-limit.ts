import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

import { env } from '@/config/env';

/**
 * Limitadores por escopo (docs/06, seção "Rate limiting"). Store padrão em
 * memória — se a API algum dia rodar em mais de uma instância, trocar pelo
 * `rate-limit-redis` aproveitando o Redis já presente (decisão registrada
 * no documento, não redescoberta aqui).
 *
 * `app.set('trust proxy', 1)` já é feito em `http/app.ts`; sem isso, atrás
 * do IIS, todas as requisições contam como vindas do mesmo IP.
 */

const MINUTES_TO_MS = 60 * 1000;

/**
 * Resposta padronizada de 429: envelope de erro (docs/05) com `Retry-After`.
 * `express-rate-limit` já define o header antes de chamar este handler
 * (via `standardHeaders`); o `setHeader` abaixo é só defensivo.
 */
function rateLimitExceededHandler(
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura exigida pelo tipo RateLimitExceededEventHandler
  _next: NextFunction,
): void {
  const requestId = typeof req.id === 'string' ? req.id : undefined;

  if (!res.getHeader('Retry-After')) {
    res.setHeader('Retry-After', '60');
  }

  res.status(429).json({
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Muitas requisições. Tente novamente mais tarde.',
      ...(requestId ? { requestId } : {}),
    },
  });
}

/** Normaliza o e-mail do corpo da requisição para compor a chave de login/registro. */
function normalizedEmailFromBody(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const email = body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : 'sem-email';
}

function keyByAuthenticatedUser(req: Request): string {
  // Só é usado depois de `authenticate`, então req.auth sempre existe aqui;
  // o fallback por IP é só defensivo (nunca deveria disparar em produção).
  return req.auth ? `user:${req.auth.userId}` : ipKeyGenerator(req.ip ?? 'sem-ip');
}

export interface RateLimitersConfig {
  authMaxRequests: number;
  authWindowMs: number;
  refreshMaxRequests: number;
  refreshWindowMs: number;
  oauthCallbackMaxRequests: number;
  oauthCallbackWindowMs: number;
  clientMaxRequests: number;
  clientWindowMs: number;
  internalMaxRequests: number;
  internalWindowMs: number;
  uploadMaxRequests: number;
  uploadWindowMs: number;
  anonymousMaxRequests: number;
  anonymousWindowMs: number;
}

export interface RateLimiters {
  authLimiter: RequestHandler;
  refreshLimiter: RequestHandler;
  oauthCallbackLimiter: RequestHandler;
  clientLimiter: RequestHandler;
  internalLimiter: RequestHandler;
  uploadLimiter: RequestHandler;
  anonymousLimiter: RequestHandler;
  rateLimitByRole: RequestHandler;
}

/**
 * Fábrica dos limitadores (docs/06, tabela de limites). Separada da
 * instanciação dos singletons de produção para que os testes possam
 * construir um conjunto próprio com janelas/limites baixos, sem depender
 * de mutar `process.env`/reimportar módulos (docs/09, estratégia de testes).
 */
export function buildRateLimiters(config: RateLimitersConfig): RateLimiters {
  const authLimiter: RequestHandler = rateLimit({
    windowMs: config.authWindowMs,
    limit: config.authMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? 'sem-ip')}:${normalizedEmailFromBody(req)}`,
    handler: rateLimitExceededHandler,
  });

  const refreshLimiter: RequestHandler = rateLimit({
    windowMs: config.refreshWindowMs,
    limit: config.refreshMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitExceededHandler,
  });

  const oauthCallbackLimiter: RequestHandler = rateLimit({
    windowMs: config.oauthCallbackWindowMs,
    limit: config.oauthCallbackMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitExceededHandler,
  });

  const clientLimiter: RequestHandler = rateLimit({
    windowMs: config.clientWindowMs,
    limit: config.clientMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByAuthenticatedUser,
    handler: rateLimitExceededHandler,
  });

  // Limite intencionalmente alto: rede de proteção contra loop acidental no
  // front, não uma restrição real ao trabalho da equipe (docs/06).
  const internalLimiter: RequestHandler = rateLimit({
    windowMs: config.internalWindowMs,
    limit: config.internalMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByAuthenticatedUser,
    handler: rateLimitExceededHandler,
  });

  const uploadLimiter: RequestHandler = rateLimit({
    windowMs: config.uploadWindowMs,
    limit: config.uploadMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByAuthenticatedUser,
    handler: rateLimitExceededHandler,
  });

  const anonymousLimiter: RequestHandler = rateLimit({
    windowMs: config.anonymousWindowMs,
    limit: config.anonymousMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitExceededHandler,
  });

  /**
   * Dispatcher usado nas rotas autenticadas de negócio (docs/06): decide
   * qual limitador aplicar de acordo com o papel resolvido por
   * `authenticate`. Deve vir sempre depois de `authenticate` na cadeia.
   */
  const rateLimitByRole: RequestHandler = (req, res, next) => {
    const role = req.auth?.role;
    if (role === 'ADMIN' || role === 'OPERATIONAL') {
      internalLimiter(req, res, next);
      return;
    }
    if (role === 'CLIENT') {
      clientLimiter(req, res, next);
      return;
    }
    anonymousLimiter(req, res, next);
  };

  return {
    authLimiter,
    refreshLimiter,
    oauthCallbackLimiter,
    clientLimiter,
    internalLimiter,
    uploadLimiter,
    anonymousLimiter,
    rateLimitByRole,
  };
}

/** Deriva a config dos limitadores a partir do env (docs/10) — usado em produção e testes. */
export function rateLimitersConfigFromEnv(): RateLimitersConfig {
  return {
    authMaxRequests: env.RATE_LIMIT_AUTH_MAX,
    authWindowMs: env.RATE_LIMIT_AUTH_WINDOW_MINUTES * MINUTES_TO_MS,
    refreshMaxRequests: env.RATE_LIMIT_REFRESH_MAX,
    refreshWindowMs: env.RATE_LIMIT_REFRESH_WINDOW_MINUTES * MINUTES_TO_MS,
    oauthCallbackMaxRequests: env.RATE_LIMIT_OAUTH_CALLBACK_MAX,
    oauthCallbackWindowMs: env.RATE_LIMIT_OAUTH_CALLBACK_WINDOW_MINUTES * MINUTES_TO_MS,
    clientMaxRequests: env.RATE_LIMIT_CLIENT_MAX,
    clientWindowMs: env.RATE_LIMIT_CLIENT_WINDOW_MINUTES * MINUTES_TO_MS,
    internalMaxRequests: env.RATE_LIMIT_INTERNAL_MAX,
    internalWindowMs: env.RATE_LIMIT_INTERNAL_WINDOW_MINUTES * MINUTES_TO_MS,
    uploadMaxRequests: env.RATE_LIMIT_UPLOAD_MAX,
    uploadWindowMs: env.RATE_LIMIT_UPLOAD_WINDOW_MINUTES * MINUTES_TO_MS,
    anonymousMaxRequests: env.RATE_LIMIT_ANONYMOUS_MAX,
    anonymousWindowMs: env.RATE_LIMIT_ANONYMOUS_WINDOW_MINUTES * MINUTES_TO_MS,
  };
}

/**
 * Singletons de produção (usados por `createApp` quando nenhum conjunto de
 * limitadores é injetado). Testes de integração que precisam de limites
 * baixos constroem o próprio conjunto via `buildRateLimiters` e injetam em
 * `createApp` — ver `tests/integration/rate-limit.test.ts`.
 */
export const defaultRateLimiters: RateLimiters = buildRateLimiters(rateLimitersConfigFromEnv());
