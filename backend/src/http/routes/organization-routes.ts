import { Router } from 'express';

import type { OrganizationController } from '@/http/controllers/organization-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authenticate } from '@/http/middlewares/authenticate';
import { authorize } from '@/http/middlewares/authorize';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { validate } from '@/http/middlewares/validate';
import {
  createEmailDomainSchema,
  createOrganizationSchema,
  listOrganizationsQuerySchema,
  organizationDomainParamsSchema,
  organizationIdParamsSchema,
  updateOrganizationSchema,
} from '@/http/schemas/organization-schemas';

/**
 * CRUD de Organization e gestão de EmailDomain (RF-10, RF-13, RF-14;
 * docs/05 seção "Organizações"). Restrito a ADMIN.
 */
export function buildOrganizationRouter(
  controller: OrganizationController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
): Router {
  const router = Router();

  router.use(authenticate(authenticateDeps), rateLimiters.rateLimitByRole, authorize('ADMIN'));

  router.get('/', validate({ query: listOrganizationsQuerySchema }), controller.list);
  router.post('/', validate({ body: createOrganizationSchema }), controller.create);
  router.get('/:id', validate({ params: organizationIdParamsSchema }), controller.getById);
  router.patch(
    '/:id',
    validate({ params: organizationIdParamsSchema, body: updateOrganizationSchema }),
    controller.update,
  );
  router.delete('/:id', validate({ params: organizationIdParamsSchema }), controller.delete);

  router.get(
    '/:id/domains',
    validate({ params: organizationIdParamsSchema }),
    controller.listDomains,
  );
  router.post(
    '/:id/domains',
    validate({ params: organizationIdParamsSchema, body: createEmailDomainSchema }),
    controller.createDomain,
  );
  router.delete(
    '/:orgId/domains/:domainId',
    validate({ params: organizationDomainParamsSchema }),
    controller.deleteDomain,
  );

  return router;
}
