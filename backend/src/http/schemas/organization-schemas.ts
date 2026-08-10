import { z } from 'zod';

import { ROLES } from '@/domain/enums';
import { paginationQuerySchema } from '@/http/schemas/pagination-schemas';

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(200),
  isInternal: z.boolean().default(false),
});
export type CreateOrganizationBody = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => data.name !== undefined || data.isActive !== undefined, {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationSchema>;

export const listOrganizationsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).optional(),
  isInternal: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;

export const createEmailDomainSchema = z.object({
  domain: z.string().trim().min(3, 'Domínio inválido.').max(255),
  defaultRole: z.enum(ROLES).default('CLIENT'),
  autoApprove: z.boolean().default(true),
});
export type CreateEmailDomainBody = z.infer<typeof createEmailDomainSchema>;

export const organizationIdParamsSchema = z.object({ id: z.string().min(1) });
export const organizationDomainParamsSchema = z.object({
  orgId: z.string().min(1),
  domainId: z.string().min(1),
});
