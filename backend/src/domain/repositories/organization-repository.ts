import type {
  CreateOrganizationData,
  Organization,
  OrganizationFilters,
  UpdateOrganizationData,
} from '@/domain/entities/organization';
import type { Page, PaginationParams } from '@/domain/pagination';

/** Contagem de vínculos usada pelo guard de exclusão (docs/04, "Regras de exclusão"). */
export interface OrganizationDependentsCount {
  users: number;
  companies: number;
  processes: number;
}

export interface OrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  list(filters: OrganizationFilters, pagination: PaginationParams): Promise<Page<Organization>>;
  create(data: CreateOrganizationData): Promise<Organization>;
  update(id: string, data: UpdateOrganizationData): Promise<Organization>;
  delete(id: string): Promise<void>;
  /** Usuários, CNPJs e processos vinculados — a Tarefa 7 bloqueia exclusão com qualquer um > 0. */
  countDependents(id: string): Promise<OrganizationDependentsCount>;
}
