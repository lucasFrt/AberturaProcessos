import { QueryClient } from '@tanstack/react-query';

/**
 * Defaults do QueryClient (docs/08, "Estado"): `staleTime` 30s,
 * `refetchOnWindowFocus: true` (rede de segurança para quando o socket
 * cai — Tarefa 18), `retry: 1`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});
