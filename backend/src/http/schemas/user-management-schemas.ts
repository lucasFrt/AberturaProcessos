import { z } from 'zod';

import { ACCESS_SCOPES, ROLES, USER_STATUSES } from '@/domain/enums';
import { paginationQuerySchema } from '@/http/schemas/pagination-schemas';

export const listUsersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(USER_STATUSES).optional(),
  role: z.enum(ROLES).optional(),
  organizationId: z.string().min(1).optional(),
  q: z.string().trim().min(1).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const listPendingUsersQuerySchema = paginationQuerySchema;

export const approveUserSchema = z
  .object({
    role: z.enum(ROLES),
    organizationId: z.string().min(1, 'organizationId é obrigatório.'),
    accessScope: z.enum(ACCESS_SCOPES),
    companyIds: z.array(z.string().min(1)).optional(),
  })
  .refine((data) => data.accessScope !== 'COMPANIES' || data.companyIds !== undefined, {
    message: 'companyIds é obrigatório quando accessScope = COMPANIES.',
    path: ['companyIds'],
  });
export type ApproveUserBody = z.infer<typeof approveUserSchema>;

export const rejectUserSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export type RejectUserBody = z.infer<typeof rejectUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    role: z.enum(ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    organizationId: z.string().min(1).optional(),
    accessScope: z.enum(ACCESS_SCOPES).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.role !== undefined ||
      data.status !== undefined ||
      data.organizationId !== undefined ||
      data.accessScope !== undefined,
    { message: 'Informe ao menos um campo para atualizar.' },
  );
export type UpdateUserBody = z.infer<typeof updateUserSchema>;

export const replaceUserCompaniesSchema = z.object({
  companyIds: z.array(z.string().min(1)),
});
export type ReplaceUserCompaniesBody = z.infer<typeof replaceUserCompaniesSchema>;

export const userIdParamsSchema = z.object({ id: z.string().min(1) });
