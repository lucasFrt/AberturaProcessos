import type { Organization } from '@/domain/entities/organization';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';

export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly items: Organization[] = [];

  async findById(id: string): Promise<Organization | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }
}
