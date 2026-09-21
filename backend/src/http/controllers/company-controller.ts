import type { NextFunction, Request, Response } from 'express';

import { presentCnpjLookup, presentCompany } from '@/http/presenters/company-presenter';
import { presentCollection } from '@/http/presenters/pagination-presenter';
import type {
  CnpjLookupParams,
  CreateCompanyBody,
  ListCompaniesQuery,
  UpdateCompanyBody,
} from '@/http/schemas/company-schemas';
import type { CompanyService } from '@/services/company-service';

export class CompanyController {
  constructor(private readonly service: CompanyService) {}

  list = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleList(req, res, next);
  };

  private async handleList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ListCompaniesQuery;
      const page = await this.service.list(
        {
          q: query.q,
          organizationId: query.organizationId,
          isActive: query.isActive,
          pendingRegistration: query.pendingRegistration,
        },
        { page: query.page, pageSize: query.pageSize },
      );
      res
        .status(200)
        .json(
          presentCollection(page, { page: query.page, pageSize: query.pageSize }, presentCompany),
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
      const body = req.body as CreateCompanyBody;
      const company = await this.service.create({
        cnpj: body.cnpj,
        legalName: body.legalName,
        tradeName: body.tradeName,
        organizationId: body.organizationId,
      });
      res.status(201).json(presentCompany(company));
    } catch (error) {
      next(error);
    }
  }

  lookupCnpj = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleLookupCnpj(req, res, next);
  };

  private async handleLookupCnpj(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { cnpj } = req.params as unknown as CnpjLookupParams;
      const result = await this.service.lookupCnpj(cnpj);
      res.status(200).json(presentCnpjLookup(result));
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
      const company = await this.service.findById(id);
      res.status(200).json(presentCompany(company));
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
      const body = req.body as UpdateCompanyBody;
      const company = await this.service.update(id, body);
      res.status(200).json(presentCompany(company));
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
