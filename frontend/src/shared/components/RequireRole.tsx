import { App } from 'antd';
import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/store/auth-store';
import type { Role } from '@/shared/types';

/**
 * Sub-proteção por papel dentro de rotas já autenticadas (docs/08, ex.:
 * `/dashboard` e `/admin/*` restritos a `ADMIN`). Redireciona para `/board`
 * com aviso quando o papel não permite.
 */
interface RequireRoleProps {
  roles: Role[];
}

export function RequireRole({ roles }: RequireRoleProps): ReactElement {
  const role = useAuthStore((state) => state.user?.role);
  const { message } = App.useApp();
  const allowed = role !== undefined && roles.includes(role);

  useEffect(() => {
    if (!allowed) {
      void message.warning('Você não tem permissão para acessar esta página.');
    }
  }, [allowed, message]);

  if (!allowed) {
    return <Navigate to="/board" replace />;
  }

  return <Outlet />;
}
