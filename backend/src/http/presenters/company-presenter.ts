import type { Company } from '@/domain/entities/company';

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

/** Monta o DTO campo a campo — nunca `...company` (docs/06, checklist de segurança). */
export function presentCompany(company: Company): CompanyDto {
  return {
    id: company.id,
    cnpj: company.cnpj,
    legalName: company.legalName,
    tradeName: company.tradeName,
    organizationId: company.organizationId,
    isActive: company.isActive,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}
