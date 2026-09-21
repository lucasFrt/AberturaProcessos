import type { Prisma, PrismaClient } from '@prisma/client';

import type {
  Company,
  CompanyFilters,
  CreateCompanyData,
  UpdateCompanyData,
} from '@/domain/entities/company';
import type { CompanyDocumentType } from '@/domain/enums';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { CompanyRepository } from '@/domain/repositories/company-repository';

interface CompanyRecord {
  id: string;
  cnpj: string | null;
  documentType: string | null;
  legalName: string;
  tradeName: string | null;
  organizationId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  organization?: { id: string; name: string };
}

/** `documentType` é String no banco (sem enum no SQL Server, docs/04); a CHECK constraint garante o valor. */
function toDomain(record: CompanyRecord): Company {
  return {
    id: record.id,
    cnpj: record.cnpj,
    documentType:
      record.documentType === null ? null : (record.documentType as CompanyDocumentType),
    legalName: record.legalName,
    tradeName: record.tradeName,
    organizationId: record.organizationId,
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.organization
      ? { organization: { id: record.organization.id, name: record.organization.name } }
      : {}),
  };
}

export class PrismaCompanyRepository implements CompanyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findManyByIds(ids: string[]): Promise<Company[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.company.findMany({ where: { id: { in: ids } } });
    return rows.map(toDomain);
  }

  async findById(id: string): Promise<Company | null> {
    const row = await this.prisma.company.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByCnpj(cnpj: string): Promise<Company | null> {
    // `findFirst`: a unicidade é de um índice filtrado que o Prisma não conhece (docs/04).
    const row = await this.prisma.company.findFirst({ where: { cnpj } });
    return row ? toDomain(row) : null;
  }

  async list(filters: CompanyFilters, pagination: PaginationParams): Promise<Page<Company>> {
    const where: Prisma.CompanyWhereInput = {
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(filters.pendingRegistration !== undefined
        ? { cnpj: filters.pendingRegistration ? null : { not: null } }
        : {}),
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

    const [rows, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        include: { organization: { select: { id: true, name: true } } },
        orderBy: [{ legalName: 'asc' }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.company.count({ where }),
    ]);

    return { items: rows.map(toDomain), total };
  }

  async create(data: CreateCompanyData): Promise<Company> {
    const row = await this.prisma.company.create({ data });
    return toDomain(row);
  }

  async update(id: string, data: UpdateCompanyData): Promise<Company> {
    const updateData: Prisma.CompanyUpdateInput = {
      ...(data.cnpj !== undefined ? { cnpj: data.cnpj } : {}),
      ...(data.documentType !== undefined ? { documentType: data.documentType } : {}),
      ...(data.legalName !== undefined ? { legalName: data.legalName } : {}),
      ...(data.tradeName !== undefined ? { tradeName: data.tradeName } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.organizationId !== undefined
        ? { organization: { connect: { id: data.organizationId } } }
        : {}),
    };
    const row = await this.prisma.company.update({ where: { id }, data: updateData });
    return toDomain(row);
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
