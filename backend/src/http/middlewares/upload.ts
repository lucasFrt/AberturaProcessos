import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer, { MulterError } from 'multer';

import { AppError } from '@/domain/errors/app-error';

const BYTES_PER_MB = 1024 * 1024;

export interface UploadMiddlewareConfig {
  maxFileSizeMb: number;
  maxFilesPerRequest: number;
}

/**
 * Multer configurado com limite de tamanho por arquivo em
 * `MAX_UPLOAD_SIZE_MB` e sem filtro de tipo — qualquer extensão, inclusive
 * sem extensão, é aceita (RF-40; docs/05, docs/12 Tarefa 11). Usa
 * `memoryStorage`: os bytes ficam em `file.buffer`, para o
 * `StorageProvider` decidir onde/como persistir (nunca grava direto em
 * disco aqui — a camada HTTP não conhece `STORAGE_ROOT`).
 */
export function buildUploadMiddleware(config: UploadMiddlewareConfig): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.maxFileSizeMb * BYTES_PER_MB,
      files: config.maxFilesPerRequest,
    },
  }).array('files', config.maxFilesPerRequest);

  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          next(
            new AppError(
              'PAYLOAD_TOO_LARGE',
              `Arquivo acima do limite de ${config.maxFileSizeMb}MB.`,
              413,
            ),
          );
          return;
        }
        if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
          next(
            new AppError(
              'VALIDATION_ERROR',
              `Limite de ${config.maxFilesPerRequest} arquivos por requisição excedido.`,
              400,
            ),
          );
          return;
        }
      }

      next(error);
    });
  };
}
