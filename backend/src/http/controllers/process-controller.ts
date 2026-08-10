import type { NextFunction, Request, Response } from 'express';

import type { ProcessFilters, ProcessSort } from '@/domain/entities/process';
import { calculateProcessPermissions } from '@/domain/entities/process-permissions';
import { UnauthenticatedError } from '@/domain/errors/app-error';
import { presentCollection } from '@/http/presenters/pagination-presenter';
import {
  presentProcessBoard,
  presentProcessCreated,
  presentProcessDetail,
  presentProcessListItem,
} from '@/http/presenters/process-presenter';
import type {
  CreateProcessBody,
  ListProcessesQuery,
  ProcessBoardQuery,
  UpdateProcessBody,
} from '@/http/schemas/process-schemas';
import type { ProcessService } from '@/services/process-service';

function filtersFromQuery(query: {
  stageId?: string | undefined;
  clientCompanyId?: string | undefined;
  responsibleId?: string | undefined;
  organizationId?: string | undefined;
  q?: string | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
}): ProcessFilters {
  return {
    stageId: query.stageId,
    clientCompanyId: query.clientCompanyId,
    responsibleId: query.responsibleId,
    organizationId: query.organizationId,
    q: query.q,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
  };
}

export class ProcessController {
  constructor(private readonly service: ProcessService) {}

  create = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleCreate(req, res, next);
  };

  private async handleCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const body = req.body as CreateProcessBody;

      const detail = await this.service.create(req.auth.userId, req.auth.scope, {
        clientCompanyId: body.clientCompanyId,
        requestingCompanyId: body.requestingCompanyId,
        reference: body.reference,
        additionalInfo: body.additionalInfo,
      });

      const permissions = calculateProcessPermissions(req.auth.role);
      res.status(201).json(presentProcessCreated(detail, permissions));
    } catch (error) {
      next(error);
    }
  }

  list = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleList(req, res, next);
  };

  private async handleList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const query = req.query as unknown as ListProcessesQuery;

      const sort: ProcessSort = { field: query.sort, order: query.order };
      const page = await this.service.list(
        filtersFromQuery(query),
        req.auth.scope,
        { page: query.page, pageSize: query.pageSize },
        sort,
      );

      res
        .status(200)
        .json(
          presentCollection(
            page,
            { page: query.page, pageSize: query.pageSize },
            presentProcessListItem,
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  board = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleBoard(req, res, next);
  };

  private async handleBoard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const query = req.query as unknown as ProcessBoardQuery;

      const stages = await this.service.board(
        filtersFromQuery(query),
        req.auth.scope,
        query.limitPerStage,
      );

      res.status(200).json(presentProcessBoard(stages));
    } catch (error) {
      next(error);
    }
  }

  getById = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleGetById(req, res, next);
  };

  private async handleGetById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const { id } = req.params as { id: string };

      const detail = await this.service.findDetailById(id, req.auth.scope);
      const permissions = calculateProcessPermissions(req.auth.role);
      res.status(200).json(presentProcessDetail(detail, permissions));
    } catch (error) {
      next(error);
    }
  }

  update = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleUpdate(req, res, next);
  };

  private async handleUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const { id } = req.params as { id: string };
      const body = req.body as UpdateProcessBody;

      const detail = await this.service.update(id, req.auth.userId, req.auth.scope, {
        reference: body.reference,
        additionalInfo: body.additionalInfo,
        clientCompanyId: body.clientCompanyId,
        requestingCompanyId: body.requestingCompanyId,
      });

      const permissions = calculateProcessPermissions(req.auth.role);
      res.status(200).json(presentProcessDetail(detail, permissions));
    } catch (error) {
      next(error);
    }
  }
}
