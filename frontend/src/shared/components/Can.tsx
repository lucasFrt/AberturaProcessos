import type { ReactElement, ReactNode } from 'react';

import { usePermissions } from '@/shared/hooks/usePermissions';

/**
 * Renderização condicional por permissão (docs/08, "Permissões na UI"). A
 * UI espelha as permissões vindas do servidor; nunca as decide sozinha.
 * Esconder um botão é conforto de UX, a autorização real é da API.
 */
interface CanProps {
  perform: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function Can({ perform, children, fallback = null }: CanProps): ReactElement {
  const { has } = usePermissions();
  return <>{has(perform) ? children : fallback}</>;
}
