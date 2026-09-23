import type { NextFunction, Request, Response } from 'express';

import { UnauthenticatedError } from '@/domain/errors/app-error';
import { filesFromRequest } from '@/http/controllers/document-controller';
import {
  presentAdvanceCursor,
  presentIntakeCursor,
  presentIntakeEvent,
  presentIntakeResult,
  presentListMailbox,
  presentMailboxMessage,
  presentProcessMatch,
  presentSkipBatchResult,
  presentSkipIntakeResult,
} from '@/http/presenters/intake-presenter';
import { presentCollection } from '@/http/presenters/pagination-presenter';
import type {
  IntakeAdvanceCursorBody,
  IntakeAttachBody,
  IntakeCreateProcessBody,
  IntakeCursorQuery,
  IntakeListEventsQuery,
  IntakeListMailboxQuery,
  IntakeLookupQuery,
  IntakeMailboxMessageQuery,
  IntakeSkipBatchBody,
  IntakeSkipBody,
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
        company: body.company ?? {},
        requestingCompany: body.requestingCompany,
        reference: body.reference,
        additionalInfo: body.additionalInfo,
        identifiers: body.identifiers,
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
        addReferences: body.addReferences,
        fetchAttachments: body.fetchAttachments,
        files: filesFromRequest(req),
      });

      res.status(result.duplicate ? 200 : 201).json(presentIntakeResult(result, req.auth.role));
    } catch (error) {
      next(error);
    }
  }

  skip = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleSkip(req, res, next);
  };

  private async handleSkip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const body = req.body as IntakeSkipBody;
      const result = await this.service.skipEmail(req.auth.userId, {
        source: body.source,
        requester: body.requester,
        outcome: body.outcome,
        reason: body.reason,
      });
      res.status(result.duplicate ? 200 : 201).json(presentSkipIntakeResult(result));
    } catch (error) {
      next(error);
    }
  }

  skipBatch = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleSkipBatch(req, res, next);
  };

  private async handleSkipBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const body = req.body as IntakeSkipBatchBody;
      const results = await this.service.skipEmails(
        req.auth.userId,
        body.items.map((item) => ({
          source: item.source,
          requester: item.requester,
          outcome: item.outcome,
          reason: item.reason,
        })),
      );
      res.status(200).json(presentSkipBatchResult(results));
    } catch (error) {
      next(error);
    }
  }

  cursor = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleCursor(req, res, next);
  };

  private async handleCursor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as IntakeCursorQuery;
      const cursor = await this.service.getCursor(query.channel);
      res.status(200).json(presentIntakeCursor(cursor));
    } catch (error) {
      next(error);
    }
  }

  listMailbox = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleListMailbox(req, res, next);
  };

  private async handleListMailbox(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as IntakeListMailboxQuery;
      const result = await this.service.listMailbox({
        after: query.after,
        limit: query.limit,
        excludeSenders: query.exclude,
      });
      res.status(200).json(presentListMailbox(result));
    } catch (error) {
      next(error);
    }
  }

  getMailboxMessage = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleGetMailboxMessage(req, res, next);
  };

  private async handleGetMailboxMessage(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const query = req.query as unknown as IntakeMailboxMessageQuery;
      const message = await this.service.getMailboxMessage(id, query.maxChars);
      res.status(200).json(presentMailboxMessage(message));
    } catch (error) {
      next(error);
    }
  }

  advanceCursor = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleAdvanceCursor(req, res, next);
  };

  private async handleAdvanceCursor(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body = req.body as IntakeAdvanceCursorBody;
      const result = await this.service.advanceCursor({
        channel: body.channel,
        receivedAt: body.receivedAt,
        externalId: body.externalId,
      });
      res.status(200).json(presentAdvanceCursor(result));
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
        refs: query.ref,
        companyDocument: query.companyDocument,
        limit: query.limit,
      });
      res.status(200).json({
        matches: matches.map(presentProcessMatch),
        ilogAvailable: this.service.ilogLookupAvailable(),
      });
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
        {
          externalId: query.externalId,
          internetMessageId: query.internetMessageId,
          kind: query.kind,
          status: query.status,
          processId: query.processId,
        },
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
