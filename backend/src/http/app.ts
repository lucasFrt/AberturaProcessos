import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, Router } from 'express';
import helmet from 'helmet';

import { env } from '@/config/env';
import { errorHandler, notFoundHandler } from '@/http/middlewares/error-handler';
import { requestContext } from '@/http/middlewares/request-context';
import { healthRouter } from '@/http/routes/health.routes';

/**
 * Monta o app Express. Nesta etapa (Tarefa 3 do plano) existem apenas as
 * rotas de saúde; autenticação e rotas de domínio chegam nas tarefas
 * seguintes (docs/12-plano-de-tarefas.md).
 */
export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestContext());

  // Exposta na raiz (para o processo Node/NSSM consultar diretamente) e sob
  // o prefixo da API (para o proxy do IIS, que roteia /api/* para a app —
  // ver docs/11-deploy-windows-server.md).
  app.use(healthRouter);
  const apiRouter = Router();
  apiRouter.use(healthRouter);
  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
