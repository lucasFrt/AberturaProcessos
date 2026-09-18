import type { Company } from '@/domain/entities/company';
import type { CnpjLookupResult } from '@/services/company-service';

interface CompanyDto {
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
    // `list()` popula `organization` (join); create/update/findById não —
    // ver comentário em domain/entities/company.ts.
    ...(company.organization
      ? { organization: { id: company.organization.id, name: company.organization.name } }
      : {}),
  };
}

interface CnpjLookupDto {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  registrationStatus: string | null;
  alreadyRegistered: boolean;
  companyId: string | null;
  organizationId: string | null;
}

/** Campo a campo, como `presentCompany` — nada de espalhar o resultado do provedor. */
export function presentCnpjLookup(result: CnpjLookupResult): CnpjLookupDto {
  return {
    cnpj: result.cnpj,
    legalName: result.legalName,
    tradeName: result.tradeName,
    registrationStatus: result.registrationStatus,
    alreadyRegistered: result.alreadyRegistered,
    companyId: result.companyId,
    organizationId: result.organizationId,
  };
}
