import { z } from 'zod';

export const documentProcessIdParamsSchema = z.object({ id: z.string().min(1) });

export const documentIdParamsSchema = z.object({ id: z.string().min(1) });
