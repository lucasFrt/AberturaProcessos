import type { Role } from '@/domain/enums';

/**
 * Fonte única de permissões por papel (docs/06, seção "Mapa de
 * permissões"). Usada tanto pelos guards de rota (`authorize`) quanto pela
 * resposta de `/auth/me` e do detalhe do processo — evita divergência
 * entre o que a UI mostra e o que a API aceita.
 */
export const PERMISSIONS_BY_ROLE = {
  CLIENT: [
    'process:create',
    'process:read',
    'process:update',
    'document:create',
    'document:read',
    'document:delete:own',
  ],
  OPERATIONAL: [
    'process:create',
    'process:read',
    'process:update',
    'process:move',
    'process:delete',
    'process:assign',
    'document:create',
    'document:read',
    'document:delete',
  ],
  ADMIN: ['*'],
} as const satisfies Record<Role, readonly string[]>;

export function getPermissionsForRole(role: Role): readonly string[] {
  return PERMISSIONS_BY_ROLE[role];
}
