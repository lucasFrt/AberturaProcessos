import { Router } from 'express';

import type { AuthController } from '@/http/controllers/auth-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authenticate } from '@/http/middlewares/authenticate';
import { validate } from '@/http/middlewares/validate';
import { loginSchema, registerSchema } from '@/http/schemas/auth-schemas';

/**
 * Rate limiting (Tarefa 6) e login social (Tarefa 5) chegam depois — este
 * router cobre apenas as rotas de autenticação local (docs/05).
 */
export function buildAuthRouter(
  controller: AuthController,
  authenticateDeps: AuthenticateDeps,
): Router {
  const router = Router();

  router.post('/register', validate({ body: registerSchema }), controller.register);
  router.post('/login', validate({ body: loginSchema }), controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', authenticate(authenticateDeps), controller.me);

  return router;
}
