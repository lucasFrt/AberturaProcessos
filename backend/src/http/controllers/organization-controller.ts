import type { NextFunction, Request, Response } from 'express';

import {
  presentEmailDomain,
  presentOrganization,
  presentOrganizationDetail,
} from '@/http/presenters/organization-presenter';
import { presentCollection } from '@/http/presenters/pagination-presenter';
import type {
  CreateEmailDomainBody,
  CreateOrganizationBody,
  ListOrganizationsQuery,
  UpdateOrganizationBody,
} from '@/http/schemas/organization-schemas';
import type { OrganizationService } from '@/services/organization-service';

export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}

  list = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleList(req, res, next);
  };

  private async handleList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ListOrganizationsQuery;
      const page = await this.service.list(
        { q: query.q, isInternal: query.isInternal, isActive: query.isActive },
        { page: query.page, pageSize: query.pageSize },
      );
      res
        .status(200)
        .json(
          presentCollection(
            page,
            { page: query.page, pageSize: query.pageSize },
            presentOrganization,
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  create = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleCreate(req, res, next);
  };

  private async handleCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateOrganizationBody;
      const organization = await this.service.create(body);
      res.status(201).json(presentOrganization(organization));
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
      res.status(200).json(presentOrganizationDetail(detail));
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
      const body = req.body as UpdateOrganizationBody;
      const organization = await this.service.update(id, body);
      res.status(200).json(presentOrganization(organization));
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

  listDomains = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleListDomains(req, res, next);
  };

  private async handleListDomains(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const domains = await this.service.listDomains(id);
      res.status(200).json({ data: domains.map(presentEmailDomain) });
    } catch (error) {
      next(error);
    }
  }

  createDomain = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleCreateDomain(req, res, next);
  };

  private async handleCreateDomain(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as CreateEmailDomainBody;
      const domain = await this.service.createDomain(id, body);
      res.status(201).json(presentEmailDomain(domain));
    } catch (error) {
      next(error);
    }
  }

  deleteDomain = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleDeleteDomain(req, res, next);
  };

  private async handleDeleteDomain(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { orgId, domainId } = req.params as { orgId: string; domainId: string };
      await this.service.deleteDomain(orgId, domainId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
