import type { Company } from '@/domain/entities/company';

/**
 * Interface mínima usada pela Tarefa 4 (resposta de /auth/me). O CRUD
 * completo de empresas chega na Tarefa 7 — este arquivo será estendido lá,
 * não substituído.
 */
export interface CompanyRepository {
  findManyByIds(ids: string[]): Promise<Company[]>;
}
