import { api } from '@/shared/api/http-client';
import type { CompanySummary, Paginated } from '@/shared/types';

/**
 * Busca de empresas para o seletor de CNPJ (docs/05, "GET /companies";
 * docs/08 "Abertura de processo"). Colocada em `features/companies/` (não
 * em `shared/`) porque é uma chamada de endpoint de um recurso CRUD
 * específico — a Tarefa 20 (admin/empresas) reaproveita este arquivo em
 * vez de duplicar a chamada; `shared/api` fica reservado para o cliente
 * HTTP genérico e a tradução de erros, não para chamadas de recurso.
 *
 * Atenção: o backend real (`backend/src/http/routes/company-routes.ts`)
 * restringe toda a rota `/companies` a ADMIN — diferente do que docs/08
 * descreve ("CLIENT vê apenas os CNPJs do seu escopo"). O formulário de
 * abertura contorna isso usando `useAuthStore().user.companies` (já
 * devolvido por `/auth/me` com o escopo do próprio usuário) para CLIENT,
 * e só chama esta busca remota para OPERATIONAL/ADMIN.
 */

interface CompanyDto {
  id: string;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  organizationId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SearchCompaniesParams {
  q?: string;
  pageSize?: number;
}

export async function searchCompanies(
  params: SearchCompaniesParams = {},
): Promise<CompanySummary[]> {
  const { data } = await api.get<Paginated<CompanyDto>>('/companies', {
    params: { q: params.q, pageSize: params.pageSize ?? 20 },
  });
  return data.data.map((company) => ({
    id: company.id,
    cnpj: company.cnpj,
    legalName: company.legalName,
  }));
}
