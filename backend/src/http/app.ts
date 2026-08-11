import type { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, Router } from 'express';
import helmet from 'helmet';

import { env } from '@/config/env';
import { buildContainer } from '@/container';
import { errorHandler, notFoundHandler } from '@/http/middlewares/error-handler';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { defaultRateLimiters } from '@/http/middlewares/rate-limit';
import { requestContext } from '@/http/middlewares/request-context';
import { buildAuthRouter } from '@/http/routes/auth-routes';
import { buildCompanyRouter } from '@/http/routes/company-routes';
import { buildDashboardRouter } from '@/http/routes/dashboard-routes';
import { buildDocumentRouter } from '@/http/routes/document-routes';
import { healthRouter } from '@/http/routes/health.routes';
import { buildKanbanStageRouter } from '@/http/routes/kanban-stage-routes';
import { buildOrganizationRouter } from '@/http/routes/organization-routes';
import { buildProcessRouter } from '@/http/routes/process-routes';
import { buildUserManagementRouter } from '@/http/routes/user-management-routes';
import { passport } from '@/passport';

/**
 * Monta o app Express. `prisma` é recebido por parâmetro (não importado
 * direto de infra/prisma/client) para que os testes de integração possam
 * injetar o cliente já conectado — mantém a montagem do app pura.
 *
 * `rateLimiters` é opcional e usa os singletons de produção (config vinda
 * do env) por padrão; testes de integração injetam um conjunto próprio com
 * limites baixos (docs/06, Tarefa 6, critério de aceite) via
 * `buildRateLimiters`, sem precisar mutar `process.env`.
 */
export function createApp(
  prisma: PrismaClient,
  rateLimiters: RateLimiters = defaultRateLimiters,
): Express {
  const app = express();
  const container = buildContainer(prisma);

  // Exposto para o processo principal fechar o QueueProvider no shutdown
  // ordenado (docs/07) sem precisar reconstruir o container.
  app.set('container', container);

  app.set('trust proxy', 1);
  app.use(helmet());
  // credentials: true exige lista explícita de origens — nunca '*' com
  // cookies (docs/06, seção "Outras proteções HTTP").
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestContext());

  // Exposta na raiz (para o processo Node/NSSM consultar diretamente) e sob
  // o prefixo da API (para o proxy do IIS, que roteia /api/* para a app —
  // ver docs/11-deploy-windows-server.md).
  app.use(healthRouter);

  // Sem sessão (JWT stateless, docs/06) — só inicializa o Passport para
  // popular `req.user` durante o handshake OAuth.
  app.use(passport.initialize());

  const apiRouter = Router();
  apiRouter.use(healthRouter);
  apiRouter.use(
    '/auth',
    buildAuthRouter(
      container.authController,
      container.authenticateDeps,
      rateLimiters,
      container.socialAuthController,
      container.configuredProviders,
    ),
  );
  apiRouter.use(
    '/organizations',
    buildOrganizationRouter(
      container.organizationController,
      container.authenticateDeps,
      rateLimiters,
    ),
  );
  apiRouter.use(
    '/companies',
    buildCompanyRouter(container.companyController, container.authenticateDeps, rateLimiters),
  );
  apiRouter.use(
    '/users',
    buildUserManagementRouter(
      container.userManagementController,
      container.authenticateDeps,
      rateLimiters,
    ),
  );
  apiRouter.use(
    '/stages',
    buildKanbanStageRouter(
      container.kanbanStageController,
      container.authenticateDeps,
      rateLimiters,
    ),
  );
  apiRouter.use(
    '/processes',
    buildProcessRouter(
      container.processController,
      container.authenticateDeps,
      rateLimiters,
      container.documentController,
      container.uploadMiddlewareConfig,
    ),
  );
  apiRouter.use(
    '/documents',
    buildDocumentRouter(container.documentController, container.authenticateDeps, rateLimiters),
  );
  apiRouter.use(
    '/dashboard',
    buildDashboardRouter(container.dashboardController, container.authenticateDeps, rateLimiters),
  );
  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
