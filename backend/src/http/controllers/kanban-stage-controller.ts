import type { NextFunction, Request, Response } from 'express';

import { UnauthenticatedError } from '@/domain/errors/app-error';
import {
  presentKanbanStage,
  presentKanbanStageWithCount,
} from '@/http/presenters/kanban-stage-presenter';
import type {
  CreateKanbanStageBody,
  ListKanbanStagesQuery,
  ReorderKanbanStagesBody,
  UpdateKanbanStageBody,
} from '@/http/schemas/kanban-stage-schemas';
import type { KanbanStageService } from '@/services/kanban-stage-service';

export class KanbanStageController {
  constructor(private readonly service: KanbanStageService) {}

  list = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleList(req, res, next);
  };

  private async handleList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ListKanbanStagesQuery;

      if (query.withCounts) {
        if (!req.auth) {
          throw new UnauthenticatedError();
        }
        const stages = await this.service.listWithCounts(req.auth.scope);
        res.status(200).json({ data: stages.map(presentKanbanStageWithCount) });
        return;
      }

      const stages = await this.service.list();
      res.status(200).json({ data: stages.map(presentKanbanStage) });
    } catch (error) {
      next(error);
    }
  }

  create = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleCreate(req, res, next);
  };

  private async handleCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateKanbanStageBody;
      const stage = await this.service.create(body);
      res.status(201).json(presentKanbanStage(stage));
    } catch (error) {
      next(error);
    }
  }

  update = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleUpdate(req, res, next);
  };

  private async handleUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as UpdateKanbanStageBody;
      const stage = await this.service.update(id, body);
      res.status(200).json(presentKanbanStage(stage));
    } catch (error) {
      next(error);
    }
  }

  reorder = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleReorder(req, res, next);
  };

  private async handleReorder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as ReorderKanbanStagesBody;
      const stages = await this.service.reorder(body.stageIds);
      res.status(200).json({ data: stages.map(presentKanbanStage) });
    } catch (error) {
      next(error);
    }
  }

  delete = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleDelete(req, res, next);
  };

  private async handleDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      await this.service.delete(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
