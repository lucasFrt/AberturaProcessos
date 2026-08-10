import { Router } from 'express';

import type { AuthController } from '@/http/controllers/auth-controller';
import { authenticate } from '@/http/middlewares/authenticate';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { validate } from '@/http/middlewares/validate';
import { loginSchema, registerSchema } from '@/http/schemas/auth-schemas';

/**
 * Login social (Tarefa 5) chega depois — este router cobre apenas as rotas
 * de autenticação local (docs/05). Rate limiting (docs/06, tabela de
 * limites): `register`/`login` por IP + e-mail, `refresh` por IP.
 */
export function buildAuthRouter(
  controller: AuthController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
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

  return router;
}
