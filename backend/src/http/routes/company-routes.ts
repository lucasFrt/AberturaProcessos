import { Router } from 'express';

import type { CompanyController } from '@/http/controllers/company-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { authenticate } from '@/http/middlewares/authenticate';
import { authorize } from '@/http/middlewares/authorize';
import type { RateLimiters } from '@/http/middlewares/rate-limit';
import { validate } from '@/http/middlewares/validate';
import {
  cnpjLookupParamsSchema,
  companyIdParamsSchema,
  createCompanySchema,
  listCompaniesQuerySchema,
  updateCompanySchema,
} from '@/http/schemas/company-schemas';

/**
 * CRUD de Company com validação de CNPJ (RF-11, RF-12; docs/05 seção
 * "Empresas / CNPJs"). Escrita restrita a ADMIN; a listagem para CLIENT
 * (filtrada pelo próprio escopo) fica para a Tarefa 9, quando o escopo de
 * processos entrar em produção — por ora, restringimos a rota toda a ADMIN
 * (nenhum outro papel consome `/companies` ainda).
 */
export function buildCompanyRouter(
  controller: CompanyController,
  authenticateDeps: AuthenticateDeps,
  rateLimiters: RateLimiters,
): Router {
  const router = Router();

  router.use(authenticate(authenticateDeps), rateLimiters.rateLimitByRole, authorize('ADMIN'));

  router.get('/', validate({ query: listCompaniesQuerySchema }), controller.list);
  router.post('/', validate({ body: createCompanySchema }), controller.create);
  // Declarada antes de `/:id` por clareza. Não há ambiguidade real: `/:id`
  // casa um único segmento, e esta rota tem dois (`/lookup/<cnpj>`).
  router.get('/lookup/:cnpj', validate({ params: cnpjLookupParamsSchema }), controller.lookupCnpj);
  router.get('/:id', validate({ params: companyIdParamsSchema }), controller.getById);
  router.patch(
    '/:id',
    validate({ params: companyIdParamsSchema, body: updateCompanySchema }),
    controller.update,
  );
  router.delete('/:id', validate({ params: companyIdParamsSchema }), controller.delete);

  return router;
}
