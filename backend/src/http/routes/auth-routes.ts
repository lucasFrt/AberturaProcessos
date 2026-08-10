import { Router } from 'express';

import type { AuthController } from '@/http/controllers/auth-controller';
import type { SocialAuthController } from '@/http/controllers/social-auth-controller';
import { authenticate } from '@/http/middlewares/authenticate';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { validate } from '@/http/middlewares/validate';
import { loginSchema, registerSchema } from '@/http/schemas/auth-schemas';
import type { ConfiguredProviders } from '@/passport';

/**
 * Rate limiting (docs/06, tabela de limites): `register`/`login` por IP +
 * e-mail, `refresh` por IP, callbacks OAuth por IP. Login social (Tarefa 5)
 * monta `/google` e `/microsoft` só quando o provedor tem credencial
 * configurada — a ausência de credencial nunca impede a subida da API.
 */
export function buildAuthRouter(
  controller: AuthController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
  socialAuthController: SocialAuthController,
  configuredProviders: ConfiguredProviders,
): Router {
  const router = Router();

  router.post(
    '/register',
    rateLimiters.authLimiter,
    validate({ body: registerSchema }),
    controller.register,
  );
  router.post(
    '/login',
    rateLimiters.authLimiter,
    validate({ body: loginSchema }),
    controller.login,
  );
  router.post('/refresh', rateLimiters.refreshLimiter, controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', authenticate(authenticateDeps), rateLimiters.rateLimitByRole, controller.me);

  router.get('/providers', socialAuthController.providers);

  if (configuredProviders.google) {
    router.get('/google', rateLimiters.oauthCallbackLimiter, socialAuthController.start('google'));
    router.get(
      '/google/callback',
      rateLimiters.oauthCallbackLimiter,
      socialAuthController.callback('google'),
    );
  }

  if (configuredProviders.microsoft) {
    router.get(
      '/microsoft',
      rateLimiters.oauthCallbackLimiter,
      socialAuthController.start('microsoft'),
    );
    router.get(
      '/microsoft/callback',
      rateLimiters.oauthCallbackLimiter,
      socialAuthController.callback('microsoft'),
    );
  }

  return router;
}
