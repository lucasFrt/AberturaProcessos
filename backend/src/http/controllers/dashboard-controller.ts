import type { NextFunction, Request, Response } from 'express';

import { presentDashboardMetrics } from '@/http/presenters/dashboard-presenter';
import type { DashboardMetricsQuery } from '@/http/schemas/dashboard-schemas';
import type { DashboardService } from '@/services/dashboard-service';

const DEFAULT_PERIOD_DAYS = 30;

/**
 * Últimos 30 dias (docs/05: "padrão últimos 30 dias"). `to` é o instante
 * atual (não meia-noite) para não excluir eventos do próprio dia.
 */
function defaultPeriod(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return { from, to };
}

export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  getMetrics = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleGetMetrics(req, res, next);
  };

  private async handleGetMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as DashboardMetricsQuery;
      const { from: defaultFrom, to: defaultTo } = defaultPeriod();

      const metrics = await this.service.getMetrics({
        from: query.from ?? defaultFrom,
        to: query.to ?? defaultTo,
        organizationId: query.organizationId,
      });

      res.status(200).json(presentDashboardMetrics(metrics));
    } catch (error) {
      next(error);
    }
  }
}
