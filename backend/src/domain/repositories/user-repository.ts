import type { CreateUserData, UpdateUserData, User } from '@/domain/entities/user';
import type { Role, UserStatus } from '@/domain/enums';
import type { Page, PaginationParams } from '@/domain/pagination';

export interface UserFilters {
  status?: UserStatus | undefined;
  role?: Role | undefined;
  organizationId?: string | undefined;
  /** Busca livre em nome/e-mail. */
  q?: string | undefined;
}

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
  list(filters: UserFilters, pagination: PaginationParams): Promise<Page<User>>;
  /** Usuários ACTIVE com papel dentro de `roles` — usado por GET /users/operational. */
  listActiveByRoles(roles: Role[]): Promise<User[]>;
  /** Total de ADMIN com status ACTIVE, opcionalmente excluindo um id (guard "ao menos um ADMIN"). */
  countActiveAdmins(excludeUserId?: string): Promise<number>;
  /** Substitui por completo o conjunto de UserCompany do usuário. */
  replaceCompanyAccess(userId: string, companyIds: string[]): Promise<void>;
}
