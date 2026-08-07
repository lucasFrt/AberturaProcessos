import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { errorHandler } from '@/http/middlewares/error-handler';
import { healthRouter } from '@/http/routes/health.routes';
import { logger } from '@/infra/logger';

/**
 * Monta o app Express. Nesta etapa (Tarefa 1 do plano) só existe o health
 * check; autenticação, rotas de domínio e demais middlewares chegam nas
 * tarefas seguintes (docs/12-plano-de-tarefas.md).
 */
export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.use(healthRouter);

  app.use(errorHandler);

  return app;
}
