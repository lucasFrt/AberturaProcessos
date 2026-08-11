import { api } from '@/shared/api/http-client';
import type { Paginated } from '@/shared/types';

/**
 * CRUD de empresas para ADMIN (docs/05, "Empresas / CNPJs").
 * O `searchCompanies` de `features/companies/api/company-api.ts` continua
 * sendo usado para o seletor; este módulo é o CRUD completo de
 * administração.
 */

export interface CompanyDto {
  id: string;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  organizationId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  organization?: { id: string; name: string };
}

export interface ListCompaniesParams {
  q?: string;
  organizationId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listCompanies(
  params: ListCompaniesParams = {},
): Promise<Paginated<CompanyDto>> {
  const { data } = await api.get<Paginated<CompanyDto>>('/companies', { params });
  return data;
}

export interface CreateCompanyPayload {
  cnpj: string;
  legalName: string;
  tradeName?: string;
  organizationId: string;
}

export async function createCompany(payload: CreateCompanyPayload): Promise<CompanyDto> {
  const { data } = await api.post<CompanyDto>('/companies', payload);
  return data;
}

export interface UpdateCompanyPayload {
  legalName?: string;
  tradeName?: string;
  isActive?: boolean;
  organizationId?: string;
}

export async function updateCompany(
  id: string,
  payload: UpdateCompanyPayload,
): Promise<CompanyDto> {
  const { data } = await api.patch<CompanyDto>(`/companies/${id}`, payload);
  return data;
}

export async function deleteCompany(id: string): Promise<void> {
  await api.delete(`/companies/${id}`);
}
