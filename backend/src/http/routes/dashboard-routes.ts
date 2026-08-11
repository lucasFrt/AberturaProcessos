import { Router } from 'express';

import type { DashboardController } from '@/http/controllers/dashboard-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authenticate } from '@/http/middlewares/authenticate';
import { authorize } from '@/http/middlewares/authorize';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { validate } from '@/http/middlewares/validate';
import { dashboardMetricsQuerySchema } from '@/http/schemas/dashboard-schemas';

/**
 * Métricas do dashboard gerencial (RF-60 a RF-63; docs/05 seção "Dashboard
 * (ADMIN)"). Restrito a ADMIN — o título da seção do contrato já indica
 * isso, e a matriz de permissões (docs/02) não lista OPERATIONAL nem
 * CLIENT para esta rota.
 */
export function buildDashboardRouter(
  controller: DashboardController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
): Router {
  const router = Router();

  router.use(authenticate(authenticateDeps), rateLimiters.rateLimitByRole);

  router.get(
    '/metrics',
    authorize('ADMIN'),
    validate({ query: dashboardMetricsQuerySchema }),
    controller.getMetrics,
  );

  return router;
}
