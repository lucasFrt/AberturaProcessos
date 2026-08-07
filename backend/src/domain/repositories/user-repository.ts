import type { CreateUserData, UpdateUserData, User } from '@/domain/entities/user';

/**
 * Persistência de usuários. Nenhum método aqui conhece Prisma — a
 * implementação vive em infra/prisma/repositories (docs/03-arquitetura.md).
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User>;
  /** CNPJs explicitamente vinculados via UserCompany (accessScope = COMPANIES). */
  listCompanyIdsByUser(userId: string): Promise<string[]>;
  /** CNPJs ativos da organização do usuário (accessScope = ORGANIZATION). */
  listActiveCompanyIdsByOrganization(organizationId: string): Promise<string[]>;
}
