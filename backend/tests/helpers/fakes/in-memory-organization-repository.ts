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

let idCounter = 0;

export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly items: Organization[] = [];
  /** organizationId -> contagem simulada de vínculos, para testar o guard de exclusão. */
  readonly dependents = new Map<string, OrganizationDependentsCount>();

  async findById(id: string): Promise<Organization | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async list(
    filters: OrganizationFilters,
    pagination: PaginationParams,
  ): Promise<Page<Organization>> {
    const filtered = this.items.filter((item) => {
      if (filters.q && !item.name.toLowerCase().includes(filters.q.toLowerCase())) return false;
      if (filters.isInternal !== undefined && item.isInternal !== filters.isInternal) return false;
      if (filters.isActive !== undefined && item.isActive !== filters.isActive) return false;
      return true;
    });

    const start = (pagination.page - 1) * pagination.pageSize;
    return { items: filtered.slice(start, start + pagination.pageSize), total: filtered.length };
  }

  async create(data: CreateOrganizationData): Promise<Organization> {
    idCounter += 1;
    const now = new Date();
    const organization: Organization = {
      id: `org-${idCounter}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.items.push(organization);
    return organization;
  }

  async update(id: string, data: UpdateOrganizationData): Promise<Organization> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`Organization ${id} não encontrada no fake.`);
    const current = this.items[index];
    if (!current) throw new Error(`Organization ${id} não encontrada no fake.`);

    const updated: Organization = {
      ...current,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      updatedAt: new Date(),
    };
    this.items[index] = updated;
    return updated;
  }

  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index !== -1) this.items.splice(index, 1);
  }

  async countDependents(id: string): Promise<OrganizationDependentsCount> {
    return this.dependents.get(id) ?? { users: 0, companies: 0, processes: 0 };
  }
}
