import type { PrismaClient } from '@prisma/client';

import type { CreateUserData, UpdateUserData, User } from '@/domain/entities/user';
import type { AccessScopeKind, Role, UserStatus } from '@/domain/enums';
import type { UserRepository } from '@/domain/repositories/user-repository';

/**
 * Traduz o model `users` do Prisma para a entidade `User` do domínio.
 * Nenhum outro arquivo fora de `infra/prisma` importa `@prisma/client`
 * para lidar com usuários (docs/03-arquitetura.md).
 */
function toDomain(record: {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  role: string;
  status: string;
  accessScope: string;
  organizationId: string | null;
  avatarUrl: string | null;
  lastLoginAt: Date | null;
  approvedAt: Date | null;
  approvedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): User {
  return {
    ...record,
    role: record.role as Role,
    status: record.status as UserStatus,
    accessScope: record.accessScope as AccessScopeKind,
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { id } });
    return record ? toDomain(record) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { email } });
    return record ? toDomain(record) : null;
  }

  async create(data: CreateUserData): Promise<User> {
    const record = await this.prisma.user.create({ data });
    return toDomain(record);
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    const record = await this.prisma.user.update({ where: { id }, data });
    return toDomain(record);
  }

  async listCompanyIdsByUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.userCompany.findMany({
      where: { userId },
      select: { companyId: true },
    });
    return rows.map((row) => row.companyId);
  }

  async listActiveCompanyIdsByOrganization(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.company.findMany({
      where: { organizationId, isActive: true },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}
