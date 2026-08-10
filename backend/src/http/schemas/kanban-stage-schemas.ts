import { z } from 'zod';

// `color` mapeia para NVarChar(9) no banco (docs/04) — hex de 6 ou 8 dígitos, com "#".
const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/, 'Cor inválida. Use um hex como "#1677ff".');

export const createKanbanStageSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(100),
  color: hexColorSchema.optional(),
  isFinal: z.boolean().optional(),
});
export type CreateKanbanStageBody = z.infer<typeof createKanbanStageSchema>;

export const updateKanbanStageSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    color: hexColorSchema.optional(),
    isFinal: z.boolean().optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.color !== undefined || data.isFinal !== undefined,
    { message: 'Informe ao menos um campo para atualizar.' },
  );
export type UpdateKanbanStageBody = z.infer<typeof updateKanbanStageSchema>;

export const reorderKanbanStagesSchema = z.object({
  stageIds: z.array(z.string().min(1)).min(1, 'Informe ao menos um id.'),
});
export type ReorderKanbanStagesBody = z.infer<typeof reorderKanbanStagesSchema>;

export const listKanbanStagesQuerySchema = z.object({
  withCounts: z.coerce.boolean().optional(),
});
export type ListKanbanStagesQuery = z.infer<typeof listKanbanStagesQuerySchema>;

export const kanbanStageIdParamsSchema = z.object({ id: z.string().min(1) });
