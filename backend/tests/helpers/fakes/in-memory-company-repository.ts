import type {
  Company,
  CompanyFilters,
  CreateCompanyData,
  UpdateCompanyData,
} from '@/domain/entities/company';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { CompanyRepository } from '@/domain/repositories/company-repository';

let idCounter = 0;

export class InMemoryCompanyRepository implements CompanyRepository {
  readonly items: Company[] = [];
  /** companyId -> contagem simulada de processos vinculados. */
  readonly linkedProcessCounts = new Map<string, number>();

  async findManyByIds(ids: string[]): Promise<Company[]> {
    return this.items.filter((item) => ids.includes(item.id));
  }

  async findById(id: string): Promise<Company | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async findByCnpj(cnpj: string): Promise<Company | null> {
    return this.items.find((item) => item.cnpj === cnpj) ?? null;
  }

  async list(filters: CompanyFilters, pagination: PaginationParams): Promise<Page<Company>> {
    const filtered = this.items.filter((item) => {
      if (filters.organizationId && item.organizationId !== filters.organizationId) return false;
      if (filters.isActive !== undefined && item.isActive !== filters.isActive) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        const matches =
          item.legalName.toLowerCase().includes(q) ||
          (item.tradeName?.toLowerCase().includes(q) ?? false) ||
          item.cnpj.includes(q);
        if (!matches) return false;
      }
      return true;
    });

    const start = (pagination.page - 1) * pagination.pageSize;
    return { items: filtered.slice(start, start + pagination.pageSize), total: filtered.length };
  }

  async create(data: CreateCompanyData): Promise<Company> {
    idCounter += 1;
    const now = new Date();
    const company: Company = {
      id: `company-${idCounter}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.items.push(company);
    return company;
  }

  async update(id: string, data: UpdateCompanyData): Promise<Company> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`Company ${id} não encontrada no fake.`);
    const current = this.items[index];
    if (!current) throw new Error(`Company ${id} não encontrada no fake.`);

    const updated: Company = {
      ...current,
      ...(data.legalName !== undefined ? { legalName: data.legalName } : {}),
      ...(data.tradeName !== undefined ? { tradeName: data.tradeName } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.organizationId !== undefined ? { organizationId: data.organizationId } : {}),
      updatedAt: new Date(),
    };
    this.items[index] = updated;
    return updated;
  }

  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index !== -1) this.items.splice(index, 1);
  }

  async countLinkedProcesses(id: string): Promise<number> {
    return this.linkedProcessCounts.get(id) ?? 0;
  }
}
