import { Router } from 'express';

import type { ProcessController } from '@/http/controllers/process-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authenticate } from '@/http/middlewares/authenticate';
import { authorize } from '@/http/middlewares/authorize';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { validate } from '@/http/middlewares/validate';
import {
  assignResponsibleSchema,
  createProcessSchema,
  listProcessesQuerySchema,
  moveProcessStageSchema,
  processBoardQuerySchema,
  processHistoryQuerySchema,
  processIdParamsSchema,
  updateProcessSchema,
} from '@/http/schemas/process-schemas';

/**
 * Criação e listagem de processos com escopo (RF-20 a RF-24, RNF-01;
 * docs/05 seção "Processos"). Todos os papéis autenticados podem
 * criar/listar/ler/editar — a diferenciação real acontece pelo
 * `AccessScope` aplicado no repositório (CLIENT só vê o que está no seu
 * escopo) e pela validação explícita no service na escrita.
 */
export function buildProcessRouter(
  controller: ProcessController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
): Router {
  const router = Router();

  router.use(authenticate(authenticateDeps), rateLimiters.rateLimitByRole);

  router.post(
    '/',
    authorize('CLIENT', 'OPERATIONAL', 'ADMIN'),
    validate({ body: createProcessSchema }),
    controller.create,
  );

  router.get('/', validate({ query: listProcessesQuerySchema }), controller.list);

  // Precisa vir antes de "/:id" — caso contrário "board" seria capturado
  // como valor de `:id`.
  router.get('/board', validate({ query: processBoardQuerySchema }), controller.board);

  router.get('/:id', validate({ params: processIdParamsSchema }), controller.getById);

  router.patch(
    '/:id',
    authorize('CLIENT', 'OPERATIONAL', 'ADMIN'),
    validate({ params: processIdParamsSchema, body: updateProcessSchema }),
    controller.update,
  );

  // Mover, atribuir responsável e excluir são restritos a usuários
  // internos (docs/05, docs/02 "Matriz de permissões") — CLIENT recebe 403.
  router.patch(
    '/:id/stage',
    authorize('OPERATIONAL', 'ADMIN'),
    validate({ params: processIdParamsSchema, body: moveProcessStageSchema }),
    controller.moveStage,
  );

  router.patch(
    '/:id/responsible',
    authorize('OPERATIONAL', 'ADMIN'),
    validate({ params: processIdParamsSchema, body: assignResponsibleSchema }),
    controller.assignResponsible,
  );

  router.delete(
    '/:id',
    authorize('OPERATIONAL', 'ADMIN'),
    validate({ params: processIdParamsSchema }),
    controller.delete,
  );

  router.get(
    '/:id/history',
    validate({ params: processIdParamsSchema, query: processHistoryQuerySchema }),
    controller.history,
  );

  return router;
}
