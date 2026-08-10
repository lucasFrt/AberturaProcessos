import { Router } from 'express';

import type { UserManagementController } from '@/http/controllers/user-management-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authenticate } from '@/http/middlewares/authenticate';
import { authorize } from '@/http/middlewares/authorize';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { validate } from '@/http/middlewares/validate';
import {
  approveUserSchema,
  listPendingUsersQuerySchema,
  listUsersQuerySchema,
  rejectUserSchema,
  replaceUserCompaniesSchema,
  updateUserSchema,
  userIdParamsSchema,
} from '@/http/schemas/user-management-schemas';

/**
 * Gestão de usuários (RF-07, RF-08; docs/05 seção "Usuários"). Todas as
 * rotas exigem ADMIN, exceto `/users/operational`, acessível também a
 * OPERATIONAL (docs/05: "para popular o seletor de responsável"). Rotas
 * fixas (`/pending`, `/operational`) vêm antes de `/:id` para não colidir
 * com o parâmetro de rota.
 */
export function buildUserManagementRouter(
  controller: UserManagementController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
): Router {
  const router = Router();

  router.use(authenticate(authenticateDeps), rateLimiters.rateLimitByRole);

  router.get('/operational', authorize('OPERATIONAL', 'ADMIN'), controller.listOperational);

  router.use(authorize('ADMIN'));

  router.get('/', validate({ query: listUsersQuerySchema }), controller.list);
  router.get('/pending', validate({ query: listPendingUsersQuerySchema }), controller.listPending);
  router.get('/:id', validate({ params: userIdParamsSchema }), controller.getById);
  router.post(
    '/:id/approve',
    validate({ params: userIdParamsSchema, body: approveUserSchema }),
    controller.approve,
  );
  router.post(
    '/:id/reject',
    validate({ params: userIdParamsSchema, body: rejectUserSchema }),
    controller.reject,
  );
  router.patch(
    '/:id',
    validate({ params: userIdParamsSchema, body: updateUserSchema }),
    controller.update,
  );
  router.put(
    '/:id/companies',
    validate({ params: userIdParamsSchema, body: replaceUserCompaniesSchema }),
    controller.replaceCompanies,
  );

  return router;
}
