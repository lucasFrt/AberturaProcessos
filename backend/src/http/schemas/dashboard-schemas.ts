import { z } from 'zod';

export const dashboardMetricsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  organizationId: z.string().min(1).optional(),
});
export type DashboardMetricsQuery = z.infer<typeof dashboardMetricsQuerySchema>;
