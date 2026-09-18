import type { NextFunction, Request, Response } from 'express';

import { UnauthenticatedError } from '@/domain/errors/app-error';
import { filesFromRequest } from '@/http/controllers/document-controller';
import {
  presentIntakeEvent,
  presentIntakeResult,
  presentProcessMatch,
} from '@/http/presenters/intake-presenter';
import { presentCollection } from '@/http/presenters/pagination-presenter';
import type {
  IntakeAttachBody,
  IntakeCreateProcessBody,
  IntakeListEventsQuery,
  IntakeLookupQuery,
} from '@/http/schemas/intake-schemas';
import type { IntakeService } from '@/services/intake-service';

/**
 * Rotas de intake (docs/05, "Intake"; docs/13). Sem regra de negócio:
 * traduz body/query (já validados) para o `IntakeService` e o resultado
 * para o presenter. Os arquivos, quando a requisição é multipart, já
 * estão em `req.files` (Multer) — `filesFromRequest` é o mesmo do upload
 * comum.
 */
export class IntakeController {
  constructor(private readonly service: IntakeService) {}

  createProcess = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleCreateProcess(req, res, next);
  };

  private async handleCreateProcess(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const body = req.body as IntakeCreateProcessBody;

      const result = await this.service.createProcessFromEmail(req.auth.userId, {
        source: body.source,
        requester: body.requester,
        company: body.company,
        requestingCompany: body.requestingCompany,
        reference: body.reference,
        additionalInfo: body.additionalInfo,
        fetchAttachments: body.fetchAttachments,
        files: filesFromRequest(req),
      });

      res.status(result.duplicate ? 200 : 201).json(presentIntakeResult(result, req.auth.role));
    } catch (error) {
      next(error);
    }
  }

  attach = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleAttach(req, res, next);
  };

  private async handleAttach(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const body = req.body as IntakeAttachBody;

      const result = await this.service.attachToProcess(req.auth.userId, {
        source: body.source,
        requester: body.requester,
        processRef: body.processRef,
        processId: body.processId,
        note: body.note,
        fetchAttachments: body.fetchAttachments,
        files: filesFromRequest(req),
      });

      res.status(result.duplicate ? 200 : 201).json(presentIntakeResult(result, req.auth.role));
    } catch (error) {
      next(error);
    }
  }

  lookup = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleLookup(req, res, next);
  };

  private async handleLookup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as IntakeLookupQuery;
      const matches = await this.service.lookupProcess({
        ref: query.ref,
        companyDocument: query.companyDocument,
        requesterEmail: query.requesterEmail,
        limit: query.limit,
      });
      res.status(200).json({ matches: matches.map(presentProcessMatch) });
    } catch (error) {
      next(error);
    }
  }

  listEvents = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleListEvents(req, res, next);
  };

  private async handleListEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as IntakeListEventsQuery;
      const page = await this.service.listEvents(
        { externalId: query.externalId, status: query.status, processId: query.processId },
        { page: query.page, pageSize: query.pageSize },
      );
      res
        .status(200)
        .json(
          presentCollection(
            page,
            { page: query.page, pageSize: query.pageSize },
            presentIntakeEvent,
          ),
        );
    } catch (error) {
      next(error);
    }
  }
}
