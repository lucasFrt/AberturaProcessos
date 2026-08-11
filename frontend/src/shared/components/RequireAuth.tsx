import { Flex, Spin } from 'antd';
import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/store/auth-store';

/**
 * Protege rotas autenticadas (docs/08, "Rotas e proteção"). Aguarda o
 * bootstrap (`refresh` + `/auth/me`, feito em `App.tsx`) antes de decidir,
 * para não piscar a tela de login em um F5.
 */
export function RequireAuth(): ReactElement {
  const isBootstrapped = useAuthStore((state) => state.isBootstrapped);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (!isBootstrapped) {
    return (
      <Flex align="center" justify="center" style={{ height: '100vh' }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
