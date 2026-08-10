import { Router } from 'express';

import type { KanbanStageController } from '@/http/controllers/kanban-stage-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authenticate } from '@/http/middlewares/authenticate';
import { authorize } from '@/http/middlewares/authorize';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { validate } from '@/http/middlewares/validate';
import {
  createKanbanStageSchema,
  kanbanStageIdParamsSchema,
  listKanbanStagesQuerySchema,
  reorderKanbanStagesSchema,
  updateKanbanStageSchema,
} from '@/http/schemas/kanban-stage-schemas';

/**
 * CRUD de KanbanStage (RF-30 a RF-33; docs/05 seção "Etapas do Kanban").
 * Leitura liberada para qualquer usuário autenticado; escrita restrita a
 * ADMIN.
 */
export function buildKanbanStageRouter(
  controller: KanbanStageController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
): Router {
  const router = Router();

  router.use(authenticate(authenticateDeps), rateLimiters.rateLimitByRole);

  router.get('/', validate({ query: listKanbanStagesQuerySchema }), controller.list);

  router.post(
    '/',
    authorize('ADMIN'),
    validate({ body: createKanbanStageSchema }),
    controller.create,
  );

  // Precisa vir antes de "/:id" — caso contrário "reorder" seria capturado
  // como valor de `:id` (ambas as rotas usam PATCH).
  router.patch(
    '/reorder',
    authorize('ADMIN'),
    validate({ body: reorderKanbanStagesSchema }),
    controller.reorder,
  );

  router.patch(
    '/:id',
    authorize('ADMIN'),
    validate({ params: kanbanStageIdParamsSchema, body: updateKanbanStageSchema }),
    controller.update,
  );

  router.delete(
    '/:id',
    authorize('ADMIN'),
    validate({ params: kanbanStageIdParamsSchema }),
    controller.delete,
  );

  return router;
}
