import { Router } from 'express';

import type { IntakeController } from '@/http/controllers/intake-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authenticate } from '@/http/middlewares/authenticate';
import { authorize } from '@/http/middlewares/authorize';
import { multipartJsonPayload } from '@/http/middlewares/multipart-json';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import type { UploadMiddlewareConfig } from '@/http/middlewares/upload';
import { buildUploadMiddleware } from '@/http/middlewares/upload';
import { validate } from '@/http/middlewares/validate';
import {
  intakeAttachSchema,
  intakeCreateProcessSchema,
  intakeCursorQuerySchema,
  intakeListEventsQuerySchema,
  intakeLookupQuerySchema,
  intakeSkipSchema,
} from '@/http/schemas/intake-schemas';

/**
 * Alimentação por IA (docs/05, "Intake"; docs/13). Só usuários internos —
 * na prática a chave de API do agente. Não passa pelo `uploadLimiter`
 * (30 uploads / 10 min por usuário, pensado para pessoas): um agente que
 * processa a caixa inteira num pico faria dezenas de anexos em minutos e
 * seria bloqueado; o limite interno de `rateLimitByRole` (1000/min) é a
 * rede de proteção adequada aqui.
 */
export function buildIntakeRouter(
  controller: IntakeController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
  uploadMiddlewareConfig: UploadMiddlewareConfig,
): Router {
  const router = Router();
  const uploadMiddleware = buildUploadMiddleware(uploadMiddlewareConfig);
  const multipartOrJson = multipartJsonPayload(uploadMiddleware);

  // `apiKeyFailureLimiter` antes de `authenticate`: é a única rota exposta à
  // internet só com chave de API (docs/14); conta apenas 401 por IP.
  router.use(
    rateLimiters.apiKeyFailureLimiter,
    authenticate(authenticateDeps),
    rateLimiters.rateLimitByRole,
    authorize('OPERATIONAL', 'ADMIN'),
  );

  // Rotas fixas antes de qualquer parâmetro (mesma regra das demais).
  router.get('/processes/lookup', validate({ query: intakeLookupQuerySchema }), controller.lookup);

  router.post(
    '/processes',
    multipartOrJson,
    validate({ body: intakeCreateProcessSchema }),
    controller.createProcess,
  );

  router.post(
    '/attachments',
    multipartOrJson,
    validate({ body: intakeAttachSchema }),
    controller.attach,
  );

  router.get('/events', validate({ query: intakeListEventsQuerySchema }), controller.listEvents);

  // Cursor e descarte/escalada (docs/13, decisão 9): JSON puro, sem multipart.
  router.get('/cursor', validate({ query: intakeCursorQuerySchema }), controller.cursor);
  router.post('/events/skip', validate({ body: intakeSkipSchema }), controller.skip);

  return router;
}
