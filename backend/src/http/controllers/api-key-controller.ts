import type { NextFunction, Request, Response } from 'express';

import { UnauthenticatedError } from '@/domain/errors/app-error';
import { presentApiKey, presentCreatedApiKey } from '@/http/presenters/api-key-presenter';
import type { CreateApiKeyBody } from '@/http/schemas/api-key-schemas';
import type { ApiKeyService } from '@/services/api-key-service';

export class ApiKeyController {
  constructor(private readonly service: ApiKeyService) {}

  create = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleCreate(req, res, next);
  };

  private async handleCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const body = req.body as CreateApiKeyBody;
      const created = await this.service.create(req.auth.userId, {
        name: body.name,
        userId: body.userId,
      });
      res.status(201).json(presentCreatedApiKey(created));
    } catch (error) {
      next(error);
    }
  }

  list = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleList(req, res, next);
  };

  private async handleList(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const apiKeys = await this.service.list();
      res.status(200).json({ data: apiKeys.map(presentApiKey) });
    } catch (error) {
      next(error);
    }
  }

  revoke = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleRevoke(req, res, next);
  };

  private async handleRevoke(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      await this.service.revoke(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
