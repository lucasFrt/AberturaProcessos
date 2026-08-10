import type { Role } from '@/domain/enums';
import { PERMISSIONS_BY_ROLE } from '@/domain/permissions';

/**
 * `permissions` calculado por processo, devolvido em `GET /processes/:id`
 * (docs/05). Deriva do mapa de permissões por papel (docs/06,
 * "Mapa de permissões") — fonte única para não divergir do que os
 * endpoints de escrita realmente aceitam.
 */
export interface ProcessPermissions {
  canEdit: boolean;
  canMove: boolean;
  canDelete: boolean;
  canAssign: boolean;
  canUploadDocument: boolean;
}

function hasPermission(role: Role, permission: string): boolean {
  const permissions: readonly string[] = PERMISSIONS_BY_ROLE[role];
  return permissions.includes('*') || permissions.includes(permission);
}

export function calculateProcessPermissions(role: Role): ProcessPermissions {
  return {
    canEdit: hasPermission(role, 'process:update'),
    canMove: hasPermission(role, 'process:move'),
    canDelete: hasPermission(role, 'process:delete'),
    canAssign: hasPermission(role, 'process:assign'),
    canUploadDocument: hasPermission(role, 'document:create'),
  };
}
