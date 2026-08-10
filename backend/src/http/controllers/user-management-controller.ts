import type { NextFunction, Request, Response } from 'express';

import { UnauthenticatedError } from '@/domain/errors/app-error';
import { presentCollection } from '@/http/presenters/pagination-presenter';
import {
  presentOperationalUser,
  presentUser,
  presentUserDetail,
} from '@/http/presenters/user-management-presenter';
import type { PaginationQuery } from '@/http/schemas/pagination-schemas';
import type {
  ApproveUserBody,
  ListUsersQuery,
  RejectUserBody,
  ReplaceUserCompaniesBody,
  UpdateUserBody,
} from '@/http/schemas/user-management-schemas';
import type { UserManagementService } from '@/services/user-management-service';

export class UserManagementController {
  constructor(private readonly service: UserManagementService) {}

  list = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleList(req, res, next);
  };

  private async handleList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ListUsersQuery;
      const page = await this.service.list(
        {
          status: query.status,
          role: query.role,
          organizationId: query.organizationId,
          q: query.q,
        },
        { page: query.page, pageSize: query.pageSize },
      );
      res
        .status(200)
        .json(presentCollection(page, { page: query.page, pageSize: query.pageSize }, presentUser));
    } catch (error) {
      next(error);
    }
  }

  listPending = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleListPending(req, res, next);
  };

  private async handleListPending(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as PaginationQuery;
      const page = await this.service.listPending({ page: query.page, pageSize: query.pageSize });
      res
        .status(200)
        .json(presentCollection(page, { page: query.page, pageSize: query.pageSize }, presentUser));
    } catch (error) {
      next(error);
    }
  }

  listOperational = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleListOperational(req, res, next);
  };

  private async handleListOperational(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const users = await this.service.listOperational();
      res.status(200).json({ data: users.map(presentOperationalUser) });
    } catch (error) {
      next(error);
    }
  }

  getById = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleGetById(req, res, next);
  };

  private async handleGetById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const detail = await this.service.findDetailById(id);
      res.status(200).json(presentUserDetail(detail));
    } catch (error) {
      next(error);
    }
  }

  approve = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleApprove(req, res, next);
  };

  private async handleApprove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const { id } = req.params as { id: string };
      const body = req.body as ApproveUserBody;
      const user = await this.service.approve(id, req.auth.userId, body);
      res.status(200).json(presentUser(user));
    } catch (error) {
      next(error);
    }
  }

  reject = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleReject(req, res, next);
  };

  private async handleReject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as RejectUserBody;
      const user = await this.service.reject(id, body);
      res.status(200).json(presentUser(user));
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
      const body = req.body as UpdateUserBody;
      const user = await this.service.update(id, req.auth.userId, body);
      res.status(200).json(presentUser(user));
    } catch (error) {
      next(error);
    }
  }

  replaceCompanies = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleReplaceCompanies(req, res, next);
  };

  private async handleReplaceCompanies(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as ReplaceUserCompaniesBody;
      const user = await this.service.replaceCompanies(id, body.companyIds);
      res.status(200).json(presentUser(user));
    } catch (error) {
      next(error);
    }
  }
}
