import { Router } from 'express';

import type { ApiKeyController } from '@/http/controllers/api-key-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authenticate } from '@/http/middlewares/authenticate';
import { authorize } from '@/http/middlewares/authorize';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { validate } from '@/http/middlewares/validate';
import { apiKeyIdParamsSchema, createApiKeySchema } from '@/http/schemas/api-key-schemas';

/** Chaves de API de contas de serviço (docs/13, decisão 2; docs/05, "Chaves de API"). Só ADMIN. */
export function buildApiKeyRouter(
  controller: ApiKeyController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
): Router {
  const router = Router();

  router.use(authenticate(authenticateDeps), rateLimiters.rateLimitByRole, authorize('ADMIN'));

  router.get('/', controller.list);
  router.post('/', validate({ body: createApiKeySchema }), controller.create);
  router.delete('/:id', validate({ params: apiKeyIdParamsSchema }), controller.revoke);

  return router;
}
