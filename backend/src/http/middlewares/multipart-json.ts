import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ValidationError } from '@/domain/errors/app-error';

/** Nome do campo de texto que carrega o JSON quando a requisição é multipart. */
export const MULTIPART_PAYLOAD_FIELD = 'payload';

/**
 * Deixa uma rota aceitar o mesmo corpo de duas formas (docs/05, "Intake"):
 *
 * - `application/json` — o corpo já é o payload; o middleware não faz nada;
 * - `multipart/form-data` — `uploadMiddleware` (Multer) já rodou e deixou
 *   os arquivos em `req.files`; o JSON vem no campo de texto `payload` e é
 *   promovido a `req.body`, para que o `validate({ body })` seguinte
 *   enxergue a mesma estrutura nos dois casos.
 *
 * Existe porque o agente de e-mail pode tanto pedir que o servidor baixe
 * os anexos (JSON puro, `fetchAttachments: true`) quanto enviá-los ele
 * mesmo (multipart), e o contrato não deve mudar entre os dois modos.
 */
export function multipartJsonPayload(uploadMiddleware: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.is('multipart/form-data')) {
      next();
      return;
    }

    uploadMiddleware(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }

      const body: unknown = req.body;
      const raw =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>)[MULTIPART_PAYLOAD_FIELD]
          : undefined;

      if (typeof raw !== 'string' || raw.trim().length === 0) {
        next(
          new ValidationError(
            `Requisição multipart precisa do campo de texto "${MULTIPART_PAYLOAD_FIELD}" com o JSON do payload.`,
          ),
        );
        return;
      }

      try {
        // `req.body` é `any` no Express; o `validate({ body })` seguinte é
        // quem dá forma ao conteúdo — aqui só se garante que é JSON.
        const parsed: unknown = JSON.parse(raw);
        req.body = parsed;
      } catch {
        next(new ValidationError(`O campo "${MULTIPART_PAYLOAD_FIELD}" não contém JSON válido.`));
        return;
      }
      next();
    });
  };
}
