import type { Company } from '@/domain/entities/company';
import type { EmailDomain } from '@/domain/entities/email-domain';
import type { Organization } from '@/domain/entities/organization';
import type { OrganizationDetail } from '@/services/organization-service';

interface OrganizationDto {
  id: string;
  name: string;
  isInternal: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Monta o DTO campo a campo — nunca `...organization` (docs/06, checklist de segurança). */
export function presentOrganization(organization: Organization): OrganizationDto {
  return {
    id: organization.id,
    name: organization.name,
    isInternal: organization.isInternal,
    isActive: organization.isActive,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}

interface EmailDomainDto {
  id: string;
  domain: string;
  organizationId: string;
  defaultRole: string;
  autoApprove: boolean;
  createdAt: string;
}

export function presentEmailDomain(domain: EmailDomain): EmailDomainDto {
  return {
    id: domain.id,
    domain: domain.domain,
    organizationId: domain.organizationId,
    defaultRole: domain.defaultRole,
    autoApprove: domain.autoApprove,
    createdAt: domain.createdAt.toISOString(),
  };
}

interface CompanySummaryDto {
  id: string;
  cnpj: string | null;
  legalName: string;
  tradeName: string | null;
  isActive: boolean;
}

function presentCompanySummary(company: Company): CompanySummaryDto {
  return {
    id: company.id,
    cnpj: company.cnpj,
    legalName: company.legalName,
    tradeName: company.tradeName,
    isActive: company.isActive,
  };
}

interface OrganizationDetailDto extends OrganizationDto {
  domains: EmailDomainDto[];
  companies: CompanySummaryDto[];
}

export function presentOrganizationDetail(detail: OrganizationDetail): OrganizationDetailDto {
  return {
    ...presentOrganization(detail.organization),
    domains: detail.domains.map(presentEmailDomain),
    companies: detail.companies.map(presentCompanySummary),
  };
}
