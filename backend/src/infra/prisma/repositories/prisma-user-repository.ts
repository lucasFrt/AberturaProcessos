import type { Prisma, PrismaClient } from '@prisma/client';

import type { CreateUserData, UpdateUserData, User } from '@/domain/entities/user';
import type { AccessScopeKind, Role, UserStatus } from '@/domain/enums';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { UserFilters, UserRepository } from '@/domain/repositories/user-repository';

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

  async list(filters: UserFilters, pagination: PaginationParams): Promise<Page<User>> {
    const where: Prisma.UserWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.q
        ? { OR: [{ name: { contains: filters.q } }, { email: { contains: filters.q } }] }
        : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items: records.map(toDomain), total };
  }

  async listActiveByRoles(roles: Role[]): Promise<User[]> {
    const records = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: roles } },
      orderBy: [{ name: 'asc' }],
    });
    return records.map(toDomain);
  }

  async countActiveAdmins(excludeUserId?: string): Promise<number> {
    return this.prisma.user.count({
      where: {
        role: 'ADMIN',
        status: 'ACTIVE',
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    });
  }

  async replaceCompanyAccess(userId: string, companyIds: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userCompany.deleteMany({ where: { userId } }),
      ...(companyIds.length > 0
        ? [
            this.prisma.userCompany.createMany({
              data: companyIds.map((companyId) => ({ userId, companyId })),
            }),
          ]
        : []),
    ]);
  }
}
