import type { Prisma, PrismaClient } from '@prisma/client';

import type {
  CreateOrganizationData,
  Organization,
  OrganizationFilters,
  UpdateOrganizationData,
} from '@/domain/entities/organization';
import type { Page, PaginationParams } from '@/domain/pagination';
import type {
  OrganizationDependentsCount,
  OrganizationRepository,
} from '@/domain/repositories/organization-repository';

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  async list(
    filters: OrganizationFilters,
    pagination: PaginationParams,
  ): Promise<Page<Organization>> {
    const where: Prisma.OrganizationWhereInput = {
      ...(filters.q ? { name: { contains: filters.q } } : {}),
      ...(filters.isInternal !== undefined ? { isInternal: filters.isInternal } : {}),
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.organization.count({ where }),
    ]);

    return { items, total };
  }

  async create(data: CreateOrganizationData): Promise<Organization> {
    return this.prisma.organization.create({ data });
  }

  async update(id: string, data: UpdateOrganizationData): Promise<Organization> {
    const updateData: Prisma.OrganizationUpdateInput = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    };
    return this.prisma.organization.update({ where: { id }, data: updateData });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.organization.delete({ where: { id } });
  }

  async countDependents(id: string): Promise<OrganizationDependentsCount> {
    const [users, companies, processes] = await Promise.all([
      this.prisma.user.count({ where: { organizationId: id } }),
      this.prisma.company.count({ where: { organizationId: id } }),
      this.prisma.process.count({
        where: { deletedAt: null, clientCompany: { organizationId: id } },
      }),
    ]);

    return { users, companies, processes };
  }
}
