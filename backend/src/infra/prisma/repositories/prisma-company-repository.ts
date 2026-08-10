import type { Prisma, PrismaClient } from '@prisma/client';

import type {
  Company,
  CompanyFilters,
  CreateCompanyData,
  UpdateCompanyData,
} from '@/domain/entities/company';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { CompanyRepository } from '@/domain/repositories/company-repository';

export class PrismaCompanyRepository implements CompanyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findManyByIds(ids: string[]): Promise<Company[]> {
    if (ids.length === 0) return [];
    return this.prisma.company.findMany({ where: { id: { in: ids } } });
  }

  async findById(id: string): Promise<Company | null> {
    return this.prisma.company.findUnique({ where: { id } });
  }

  async findByCnpj(cnpj: string): Promise<Company | null> {
    return this.prisma.company.findUnique({ where: { cnpj } });
  }

  async list(filters: CompanyFilters, pagination: PaginationParams): Promise<Page<Company>> {
    const where: Prisma.CompanyWhereInput = {
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(filters.q
        ? {
            OR: [
              { legalName: { contains: filters.q } },
              { tradeName: { contains: filters.q } },
              { cnpj: { contains: filters.q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        orderBy: [{ legalName: 'asc' }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.company.count({ where }),
    ]);

    return { items, total };
  }

  async create(data: CreateCompanyData): Promise<Company> {
    return this.prisma.company.create({ data });
  }

  async update(id: string, data: UpdateCompanyData): Promise<Company> {
    const updateData: Prisma.CompanyUpdateInput = {
      ...(data.legalName !== undefined ? { legalName: data.legalName } : {}),
      ...(data.tradeName !== undefined ? { tradeName: data.tradeName } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.organizationId !== undefined
        ? { organization: { connect: { id: data.organizationId } } }
        : {}),
    };
    return this.prisma.company.update({ where: { id }, data: updateData });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.company.delete({ where: { id } });
  }

  async countLinkedProcesses(id: string): Promise<number> {
    return this.prisma.process.count({
      where: {
        deletedAt: null,
        OR: [{ clientCompanyId: id }, { requestingCompanyId: id }],
      },
    });
  }
}
