import { useAuthStore } from '@/features/auth/store/auth-store';
import type { Role } from '@/shared/types';

/**
 * Lê `permissions`/`role` de `/auth/me` (via auth-store) para a UI decidir
 * o que mostrar (docs/08, "Permissões na UI"). `ADMIN` recebe `'*'` do
 * backend, que aqui vale como acesso a qualquer `perform`.
 */
export function usePermissions(): {
  role: Role | null;
  permissions: readonly string[];
  has: (perform: string) => boolean;
} {
  const user = useAuthStore((state) => state.user);
  const permissions = user?.permissions ?? [];

  function has(perform: string): boolean {
    return permissions.includes('*') || permissions.includes(perform);
  }

  return { role: user?.role ?? null, permissions, has };
}
