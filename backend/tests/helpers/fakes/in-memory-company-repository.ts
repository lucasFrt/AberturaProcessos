import type { Company } from '@/domain/entities/company';
import type { CompanyRepository } from '@/domain/repositories/company-repository';

export class InMemoryCompanyRepository implements CompanyRepository {
  readonly items: Company[] = [];

  async findManyByIds(ids: string[]): Promise<Company[]> {
    return this.items.filter((item) => ids.includes(item.id));
  }
}
