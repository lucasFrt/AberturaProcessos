import { z } from 'zod';

import { paginationQuerySchema } from '@/http/schemas/pagination-schemas';

export const createProcessSchema = z.object({
  clientCompanyId: z.string().min(1, 'clientCompanyId é obrigatório.'),
  requestingCompanyId: z.string().min(1).nullable().optional(),
  reference: z.string().trim().min(3, 'Referência precisa ter ao menos 3 caracteres.').max(255),
  additionalInfo: z.string().max(10_000).nullable().optional(),
});
export type CreateProcessBody = z.infer<typeof createProcessSchema>;

export const updateProcessSchema = z
  .object({
    reference: z.string().trim().min(3).max(255).optional(),
    additionalInfo: z.string().max(10_000).nullable().optional(),
    clientCompanyId: z.string().min(1).optional(),
    requestingCompanyId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (data) =>
      data.reference !== undefined ||
      data.additionalInfo !== undefined ||
      data.clientCompanyId !== undefined ||
      data.requestingCompanyId !== undefined,
    { message: 'Informe ao menos um campo para atualizar.' },
  );
export type UpdateProcessBody = z.infer<typeof updateProcessSchema>;

const PROCESS_SORT_FIELDS = ['createdAt', 'stageChangedAt', 'code'] as const;

export const listProcessesQuerySchema = paginationQuerySchema.extend({
  stageId: z.string().min(1).optional(),
  /** `true` = só vinculados ao iLog; `false` = só sem vínculo (docs/15). */
  ilogLinked: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  clientCompanyId: z.string().min(1).optional(),
  responsibleId: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  sort: z.enum(PROCESS_SORT_FIELDS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListProcessesQuery = z.infer<typeof listProcessesQuerySchema>;

export const processBoardQuerySchema = z.object({
  clientCompanyId: z.string().min(1).optional(),
  responsibleId: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  limitPerStage: z.coerce.number().int().positive().max(100).default(50),
});
export type ProcessBoardQuery = z.infer<typeof processBoardQuerySchema>;

export const processIdParamsSchema = z.object({ id: z.string().min(1) });

export const moveProcessStageSchema = z.object({
  toStageId: z.string().min(1, 'toStageId é obrigatório.'),
  note: z.string().max(1000).nullable().optional(),
});
export type MoveProcessStageBody = z.infer<typeof moveProcessStageSchema>;

export const assignResponsibleSchema = z.object({
  responsibleId: z.string().min(1).nullable(),
});
export type AssignResponsibleBody = z.infer<typeof assignResponsibleSchema>;

export const processHistoryQuerySchema = paginationQuerySchema;
export type ProcessHistoryQuery = z.infer<typeof processHistoryQuerySchema>;
