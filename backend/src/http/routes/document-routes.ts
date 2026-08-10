import { Router } from 'express';

import type { DocumentController } from '@/http/controllers/document-controller';
import { authenticate } from '@/http/middlewares/authenticate';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authorize } from '@/http/middlewares/authorize';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { validate } from '@/http/middlewares/validate';
import { documentIdParamsSchema } from '@/http/schemas/document-schemas';

/**
 * Download e exclusão de documentos, fora do namespace de processo
 * (docs/05, "GET /documents/:id/download" e "DELETE /documents/:id").
 * Todo papel autenticado pode baixar/excluir (o escopo de acesso e a
 * regra de "só exclui o que enviou" são aplicados dentro do service).
 */
export function buildDocumentRouter(
  controller: DocumentController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
): Router {
  const router = Router();

  router.use(authenticate(authenticateDeps), rateLimiters.rateLimitByRole);

  router.get('/:id/download', validate({ params: documentIdParamsSchema }), controller.download);

  router.delete(
    '/:id',
    authorize('CLIENT', 'OPERATIONAL', 'ADMIN'),
    validate({ params: documentIdParamsSchema }),
    controller.delete,
  );

  return router;
}
