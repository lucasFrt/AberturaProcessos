import type { CreateUserData, UpdateUserData, User } from '@/domain/entities/user';
import type { Role } from '@/domain/enums';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { UserFilters, UserRepository } from '@/domain/repositories/user-repository';

let idCounter = 0;

export class InMemoryUserRepository implements UserRepository {
  readonly items: User[] = [];
  /** userId -> companyIds explicitamente vinculadas (UserCompany). */
  readonly companyLinks = new Map<string, string[]>();
  /** organizationId -> companyIds ativas. */
  readonly organizationCompanies = new Map<string, string[]>();

  async findById(id: string): Promise<User | null> {
    return this.items.find((user) => user.id === id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.items.find((user) => user.email === email) ?? null;
  }

  async create(data: CreateUserData): Promise<User> {
    idCounter += 1;
    const now = new Date();
    const user: User = {
      id: `user-${idCounter}`,
      avatarUrl: null,
      lastLoginAt: null,
      approvedAt: null,
      approvedById: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.items.push(user);
    return user;
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    const index = this.items.findIndex((user) => user.id === id);
    if (index === -1) throw new Error(`Usuário ${id} não encontrado no fake.`);

    const current = this.items[index];
    if (!current) throw new Error(`Usuário ${id} não encontrado no fake.`);

    const updated: User = { ...current, ...data, updatedAt: new Date() };
    this.items[index] = updated;
    return updated;
  }

  async listCompanyIdsByUser(userId: string): Promise<string[]> {
    return this.companyLinks.get(userId) ?? [];
  }

  async listActiveCompanyIdsByOrganization(organizationId: string): Promise<string[]> {
    return this.organizationCompanies.get(organizationId) ?? [];
  }

  async list(filters: UserFilters, pagination: PaginationParams): Promise<Page<User>> {
    const filtered = this.items.filter((user) => {
      if (filters.status && user.status !== filters.status) return false;
      if (filters.role && user.role !== filters.role) return false;
      if (filters.organizationId && user.organizationId !== filters.organizationId) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        const matches = user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });

    const start = (pagination.page - 1) * pagination.pageSize;
    return { items: filtered.slice(start, start + pagination.pageSize), total: filtered.length };
  }

  async listActiveByRoles(roles: Role[]): Promise<User[]> {
    return this.items.filter((user) => user.status === 'ACTIVE' && roles.includes(user.role));
  }

  async countActiveAdmins(excludeUserId?: string): Promise<number> {
    return this.items.filter(
      (user) => user.role === 'ADMIN' && user.status === 'ACTIVE' && user.id !== excludeUserId,
    ).length;
  }

  async replaceCompanyAccess(userId: string, companyIds: string[]): Promise<void> {
    this.companyLinks.set(userId, [...companyIds]);
  }
}
