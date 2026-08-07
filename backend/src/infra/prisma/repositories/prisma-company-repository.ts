import type { PrismaClient } from '@prisma/client';

import type { Company } from '@/domain/entities/company';
import type { CompanyRepository } from '@/domain/repositories/company-repository';

export class PrismaCompanyRepository implements CompanyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findManyByIds(ids: string[]): Promise<Company[]> {
    if (ids.length === 0) return [];
    return this.prisma.company.findMany({ where: { id: { in: ids } } });
  }
}
