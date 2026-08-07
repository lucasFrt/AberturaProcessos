import type { Organization } from '@/domain/entities/organization';

/**
 * Interface mínima usada pela Tarefa 4 (resposta de /auth/me). O CRUD
 * completo de organizações chega na Tarefa 7 — este arquivo será estendido
 * lá, não substituído.
 */
export interface OrganizationRepository {
  findById(id: string): Promise<Organization | null>;
}
