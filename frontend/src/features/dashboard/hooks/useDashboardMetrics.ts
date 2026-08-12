import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import type {
  DashboardMetricsDto,
  DashboardMetricsFilters,
} from '@/features/dashboard/api/dashboard-api';
import { getDashboardMetrics } from '@/features/dashboard/api/dashboard-api';

/**
 * `GET /dashboard/metrics` (docs/08, "Dashboard"; docs/12, Tarefa 21). Os
 * filtros (período + organização) entram na própria chave de query, no
 * mesmo padrão de `useBoard` — trocar o período ou a organização dispara
 * um novo fetch em vez de reaproveitar cache de outra combinação.
 */
export function useDashboardMetrics(
  filters: DashboardMetricsFilters,
): UseQueryResult<DashboardMetricsDto> {
  return useQuery({
    queryKey: ['dashboard', 'metrics', filters],
    queryFn: () => getDashboardMetrics(filters),
  });
}
