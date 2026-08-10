import { Router } from 'express';

import type { DocumentController } from '@/http/controllers/document-controller';
import type { ProcessController } from '@/http/controllers/process-controller';
import { authenticate } from '@/http/middlewares/authenticate';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authorize } from '@/http/middlewares/authorize';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import type { UploadMiddlewareConfig } from '@/http/middlewares/upload';
import { buildUploadMiddleware } from '@/http/middlewares/upload';
import { validate } from '@/http/middlewares/validate';
import { documentProcessIdParamsSchema } from '@/http/schemas/document-schemas';
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
  documentController: DocumentController,
  uploadMiddlewareConfig: UploadMiddlewareConfig,
): Router {
  const router = Router();
  const uploadMiddleware = buildUploadMiddleware(uploadMiddlewareConfig);

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

  // Documentos (RF-40 a RF-44; docs/05 seção "Documentos"). Upload passa
  // pelo limitador de upload dedicado (RNF-02); leitura usa o mesmo
  // `rateLimitByRole` das demais rotas de processo (já aplicado em
  // `router.use` no topo deste router).
  router.post(
    '/:id/documents',
    authorize('CLIENT', 'OPERATIONAL', 'ADMIN'),
    rateLimiters.uploadLimiter,
    validate({ params: documentProcessIdParamsSchema }),
    uploadMiddleware,
    documentController.upload,
  );

  router.get(
    '/:id/documents',
    validate({ params: documentProcessIdParamsSchema }),
    documentController.listByProcess,
  );

  return router;
}
