import { z } from 'zod';

/** `?page=1&pageSize=20` (pageSize máximo 100), docs/05 seção "Convenções". */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
