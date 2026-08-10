import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PassportStatic } from 'passport';

import { env } from '@/config/env';
import { AppError } from '@/domain/errors/app-error';
import { setRefreshTokenCookie } from '@/http/controllers/auth-cookies';
import { sanitizeRedirectPath } from '@/http/controllers/oauth-redirect';
import type { ConfiguredProviders } from '@/passport';
import type { SocialLoginResult } from '@/services/social-auth-service';

/**
 * `passport.authenticate(...)` é tipado como `any` em `@types/passport`.
 * Este type guard isola o `unsafe-call`/`unsafe-assignment` num único
 * lugar, em vez de precisar suprimir a regra do ESLint no corpo do método.
 */
function asRequestHandler(middleware: unknown): RequestHandler {
  if (typeof middleware !== 'function') {
    throw new TypeError('passport.authenticate não retornou uma função de middleware.');
  }
  return middleware as RequestHandler;
}

/**
 * Processa o retorno dos provedores OAuth (docs/06, seção "Login social";
 * docs/05, rotas `/auth/:provider` e `/auth/:provider/callback`). O
 * `passport.authenticate` já populou `req.user` com o `SocialLoginResult`
 * retornado por `SocialAuthService.loginOrRegister` (ver
 * `src/passport/*-strategy.ts`) — este controller só decide o que fazer com
 * esse resultado: gravar cookie e redirecionar para o front.
 */
export class SocialAuthController {
  constructor(
    private readonly passport: PassportStatic,
    private readonly configuredProviders: ConfiguredProviders,
  ) {}

  providers = (_req: Request, res: Response): void => {
    res.status(200).json({ local: true, ...this.configuredProviders });
  };

  /** Middleware de início do fluxo — redirect 302 para o provedor. */
  start(provider: 'google' | 'microsoft'): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const redirectPath = sanitizeRedirectPath(req.query.redirect);
      // `passport.authenticate` retorna `any` nos tipos publicados
      // (@types/passport) — envolvido em `asRequestHandler` para não
      // desabilitar `no-unsafe-call` em todo o arquivo.
      const middleware = asRequestHandler(
        this.passport.authenticate(provider, { session: false, state: redirectPath ?? undefined }),
      );
      middleware(req, res, next);
    };
  }

  /** Middleware/controller do callback — processa o retorno e redireciona para o front. */
  callback(provider: 'google' | 'microsoft'): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const middleware = asRequestHandler(
        this.passport.authenticate(
          provider,
          { session: false },
          (error: unknown, result?: SocialLoginResult | false, info?: { state?: unknown }) => {
            this.handleCallbackResult(res, error, result, sanitizeRedirectPath(info?.state));
          },
        ),
      );
      middleware(req, res, next);
    };
  }

  private handleCallbackResult(
    res: Response,
    error: unknown,
    result: SocialLoginResult | false | undefined,
    redirectPath: string | null,
  ): void {
    const redirectQuery = redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : '';

    if (error) {
      const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      res.redirect(`${env.FRONTEND_URL}/auth/callback?status=error&code=${code}${redirectQuery}`);
      return;
    }

    if (!result) {
      res.redirect(
        `${env.FRONTEND_URL}/auth/callback?status=error&code=UNAUTHENTICATED${redirectQuery}`,
      );
      return;
    }

    if (result.status === 'PENDING') {
      res.redirect(`${env.FRONTEND_URL}/auth/callback?status=pending${redirectQuery}`);
      return;
    }

    setRefreshTokenCookie(res, result.tokens.refreshToken);
    res.redirect(`${env.FRONTEND_URL}/auth/callback?status=ok${redirectQuery}`);
  }
}
