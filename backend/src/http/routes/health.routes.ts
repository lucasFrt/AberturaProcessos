import { Router } from 'express';

import { env } from '@/config/env';
import { checkDatabaseConnection } from '@/infra/prisma/client';
import { checkRedisConnection } from '@/infra/queue/connection';

export const healthRouter = Router();

/**
 * Sem dependências externas — é o que o IIS/monitoração consulta em
 * intervalo curto (docs/05-contrato-api.md, seção Saúde).
 */
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), version: env.APP_VERSION });
});

/**
 * Verifica as dependências reais (SQL Server via `SELECT 1`, Redis via
 * `PING`). 503 se qualquer uma estiver fora, para que o orquestrador saiba
 * não rotear tráfego para esta instância.
 */
healthRouter.get('/health/ready', (_req, res, next) => {
  Promise.all([checkDatabaseConnection(), checkRedisConnection()])
    .then(([databaseOk, redisOk]) => {
      const ready = databaseOk && redisOk;
      res.status(ready ? 200 : 503).json({
        status: ready ? 'ok' : 'degraded',
        checks: {
          database: databaseOk ? 'ok' : 'down',
          redis: redisOk ? 'ok' : 'down',
        },
      });
    })
    .catch(next);
});
