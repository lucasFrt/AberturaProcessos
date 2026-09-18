import type { NextFunction, Request, Response } from 'express';

import { UnauthenticatedError, ValidationError } from '@/domain/errors/app-error';
import { presentDocument } from '@/http/presenters/document-presenter';
import type { DocumentService, UploadFileInput } from '@/services/document-service';

/**
 * Busboy (usado pelo Multer) decodifica os headers do multipart como
 * `latin1` por padrão, então nomes de arquivo em UTF-8 (acentos, ç, etc.)
 * chegam corrompidos em `file.originalname` — reinterpretar os bytes como
 * UTF-8 corrige (docs/05, download precisa preservar acentos/espaços).
 */
function decodeOriginalName(originalName: string): string {
  return Buffer.from(originalName, 'latin1').toString('utf8');
}

/**
 * Extrai os arquivos do Multer (`req.files`, `memoryStorage`) já validados
 * pelo middleware. Exportada porque o intake (docs/13) recebe multipart no
 * mesmo formato e reaproveita a mesma decodificação de nome.
 */
export function filesFromRequest(req: Request): UploadFileInput[] {
  const files = req.files;
  if (!Array.isArray(files)) {
    return [];
  }
  return files.map((file) => ({
    originalName: decodeOriginalName(file.originalname),
    mimeType: file.mimetype,
    buffer: file.buffer,
  }));
}

export class DocumentController {
  constructor(private readonly service: DocumentService) {}

  upload = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleUpload(req, res, next);
  };

  private async handleUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const { id } = req.params as { id: string };
      const files = filesFromRequest(req);
      if (files.length === 0) {
        throw new ValidationError('Envie ao menos um arquivo no campo "files".');
      }

      // Origem derivada da credencial, nunca do payload (docs/13, decisão 7).
      const source = req.auth.authKind === 'API_KEY' ? 'API' : 'WEB';
      const documents = await this.service.upload(id, req.auth.userId, req.auth.scope, files, {
        source,
      });
      res.status(201).json({ data: documents.map(presentDocument) });
    } catch (error) {
      next(error);
    }
  }

  listByProcess = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleListByProcess(req, res, next);
  };

  private async handleListByProcess(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const { id } = req.params as { id: string };

      const documents = await this.service.listByProcess(id, req.auth.scope);
      res.status(200).json({ data: documents.map(presentDocument) });
    } catch (error) {
      next(error);
    }
  }

  download = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleDownload(req, res, next);
  };

  private async handleDownload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const { id } = req.params as { id: string };

      const { document, content } = await this.service.download(id, req.auth.scope);

      // RFC 5987/6266: `filename*=UTF-8''<percent-encoded>` preserva
      // acentos e espaços; `filename=` (ASCII) é o fallback para clientes
      // antigos (docs/05, "GET /documents/:id/download").
      const asciiFallback = document.originalName.replace(/[^\x20-\x7E]/g, '_');
      const encoded = encodeURIComponent(document.originalName);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      );
      res.setHeader('Content-Type', document.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(content);
    } catch (error) {
      next(error);
    }
  }

  delete = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleDelete(req, res, next);
  };

  private async handleDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const { id } = req.params as { id: string };

      await this.service.softDelete(id, req.auth.userId, req.auth.role, req.auth.scope);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
