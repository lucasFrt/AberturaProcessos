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
  /**
   * Somente dígitos: 14 (CNPJ) ou 11 (CPF) — ver `documentType`. `null` =
   * cadastro pendente, criado pelo intake pelo domínio do e-mail (docs/13,
   * decisão 10).
   */
  cnpj: string | null;
  documentType: 'CNPJ' | 'CPF' | null;
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
  /** `true` lista só cadastros pendentes (sem CNPJ). */
  pendingRegistration?: boolean;
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
  /** Só para concluir cadastro pendente; a API recusa em empresa já completa. */
  cnpj?: string;
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

export interface CnpjLookupDto {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  /** Situação cadastral na Receita (ex.: "ATIVA"). `null` quando a empresa já está no nosso banco. */
  registrationStatus: string | null;
  /** `true` quando o CNPJ já existe no nosso banco — os dados vieram de lá, não da Receita. */
  alreadyRegistered: boolean;
  companyId: string | null;
  organizationId: string | null;
}

/**
 * Consulta os dados cadastrais do CNPJ na Receita para autopreencher o
 * formulário (docs/05, "Empresas / CNPJs"). A consulta é feita pelo backend,
 * não direto do navegador: a API da Receita não envia cabeçalhos de CORS, o
 * token do plano comercial não pode ficar no bundle e o backend ainda faz
 * cache para proteger a cota do plano gratuito.
 */
export async function lookupCnpj(cnpj: string): Promise<CnpjLookupDto> {
  const digits = cnpj.replace(/\D/g, '');
  const { data } = await api.get<CnpjLookupDto>(`/companies/lookup/${digits}`);
  return data;
}
