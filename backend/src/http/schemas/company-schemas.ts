import { z } from 'zod';

import { paginationQuerySchema } from '@/http/schemas/pagination-schemas';

export const createCompanySchema = z.object({
  /** CNPJ (14 dígitos) ou CPF (11), com ou sem máscara; os dígitos verificadores são validados no service. */
  cnpj: z.string().trim().min(11, 'CNPJ/CPF inválido.').max(20),
  legalName: z.string().trim().min(1, 'Razão social é obrigatória.').max(255),
  tradeName: z.string().trim().max(255).optional(),
  organizationId: z.string().min(1, 'organizationId é obrigatório.'),
});
export type CreateCompanyBody = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = z
  .object({
    legalName: z.string().trim().min(1).max(255).optional(),
    tradeName: z.string().trim().max(255).nullable().optional(),
    isActive: z.boolean().optional(),
    organizationId: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      data.legalName !== undefined ||
      data.tradeName !== undefined ||
      data.isActive !== undefined ||
      data.organizationId !== undefined,
    { message: 'Informe ao menos um campo para atualizar.' },
  );
export type UpdateCompanyBody = z.infer<typeof updateCompanySchema>;

export const listCompaniesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListCompaniesQuery = z.infer<typeof listCompaniesQuerySchema>;

export const companyIdParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Consulta de CNPJ na Receita. Só checa o formato bruto (com ou sem máscara);
 * os dígitos verificadores são validados no service, que é quem devolve
 * `400 INVALID_CNPJ` — mesma divisão de `createCompanySchema`.
 */
export const cnpjLookupParamsSchema = z.object({
  cnpj: z.string().trim().min(11, 'CNPJ inválido.').max(20),
});
export type CnpjLookupParams = z.infer<typeof cnpjLookupParamsSchema>;
