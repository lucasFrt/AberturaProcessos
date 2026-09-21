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
  /**
   * organizationId -> nome, para simular o join que `list()` faz no Prisma
   * (`prisma-company-repository.ts`). Sem isso, um teste que só usa este fake
   * não pega uma regressão como a que motivou este campo: `organization`
   * ficando de fora do DTO da listagem.
   */
  readonly organizationNames = new Map<string, string>();

  async findManyByIds(ids: string[]): Promise<Company[]> {
    return this.items.filter((item) => ids.includes(item.id));
  }

  async findById(id: string): Promise<Company | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async findByCnpj(cnpj: string): Promise<Company | null> {
    return this.items.find((item) => item.cnpj !== null && item.cnpj === cnpj) ?? null;
  }

  async findByIlogCompanyId(ilogCompanyId: number): Promise<Company | null> {
    return this.items.find((item) => item.ilogCompanyId === ilogCompanyId) ?? null;
  }

  async list(filters: CompanyFilters, pagination: PaginationParams): Promise<Page<Company>> {
    const filtered = this.items.filter((item) => {
      if (filters.organizationId && item.organizationId !== filters.organizationId) return false;
      if (filters.isActive !== undefined && item.isActive !== filters.isActive) return false;
      if (
        filters.pendingRegistration !== undefined &&
        (item.cnpj === null) !== filters.pendingRegistration
      )
        return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        const matches =
          item.legalName.toLowerCase().includes(q) ||
          (item.tradeName?.toLowerCase().includes(q) ?? false) ||
          (item.cnpj?.includes(q) ?? false);
        if (!matches) return false;
      }
      return true;
    });

    const start = (pagination.page - 1) * pagination.pageSize;
    const page = filtered.slice(start, start + pagination.pageSize).map((item) => {
      const name = this.organizationNames.get(item.organizationId);
      return name ? { ...item, organization: { id: item.organizationId, name } } : item;
    });
    return { items: page, total: filtered.length };
  }

  async create(data: CreateCompanyData): Promise<Company> {
    idCounter += 1;
    const now = new Date();
    const company: Company = {
      id: `company-${idCounter}`,
      cnpj: data.cnpj,
      documentType: data.documentType,
      legalName: data.legalName,
      tradeName: data.tradeName,
      organizationId: data.organizationId,
      ilogCompanyId: data.ilogCompanyId ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
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
      ...(data.cnpj !== undefined ? { cnpj: data.cnpj } : {}),
      ...(data.documentType !== undefined ? { documentType: data.documentType } : {}),
      ...(data.legalName !== undefined ? { legalName: data.legalName } : {}),
      ...(data.tradeName !== undefined ? { tradeName: data.tradeName } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.ilogCompanyId !== undefined ? { ilogCompanyId: data.ilogCompanyId } : {}),
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
