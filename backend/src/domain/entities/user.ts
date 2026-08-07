import type { AccessScopeKind, Role, UserStatus } from '@/domain/enums';

/**
 * Entidade de domínio, independente do Prisma (docs/03-arquitetura.md).
 * `PrismaUserRepository` traduz o model do banco para este tipo.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  role: Role;
  status: UserStatus;
  accessScope: AccessScopeKind;
  organizationId: string | null;
  avatarUrl: string | null;
  lastLoginAt: Date | null;
  approvedAt: Date | null;
  approvedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  name: string;
  email: string;
  passwordHash: string | null;
  role: Role;
  status: UserStatus;
  accessScope: AccessScopeKind;
  organizationId: string | null;
}

export interface UpdateUserData {
  name?: string;
  role?: Role;
  status?: UserStatus;
  accessScope?: AccessScopeKind;
  organizationId?: string | null;
  passwordHash?: string | null;
  lastLoginAt?: Date;
  approvedAt?: Date | null;
  approvedById?: string | null;
}
