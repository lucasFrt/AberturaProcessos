import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(100),
  userId: z.string().min(1, 'userId é obrigatório.'),
});
export type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;

export const apiKeyIdParamsSchema = z.object({ id: z.string().min(1) });
