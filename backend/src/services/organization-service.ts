import type { Company } from '@/domain/entities/company';
import type { CreateEmailDomainData, EmailDomain } from '@/domain/entities/email-domain';
import type {
  CreateOrganizationData,
  Organization,
  OrganizationFilters,
  UpdateOrganizationData,
} from '@/domain/entities/organization';
import { ConflictError, NotFoundError } from '@/domain/errors/app-error';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { CompanyRepository } from '@/domain/repositories/company-repository';
import type { EmailDomainRepository } from '@/domain/repositories/email-domain-repository';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';

export interface OrganizationServiceDeps {
  organizationRepository: OrganizationRepository;
  emailDomainRepository: EmailDomainRepository;
  companyRepository: CompanyRepository;
}

export interface OrganizationDetail {
  organization: Organization;
  domains: EmailDomain[];
  companies: Company[];
}

/** Normaliza domínio de e-mail (docs/05, seção "Organizações"): minúsculo, sem "@" e sem espaços. */
export function normalizeEmailDomain(rawValue: string): string {
  return rawValue.trim().toLowerCase().replace(/^@/, '').replace(/\s+/g, '');
}

/**
 * CRUD de Organization e gestão de EmailDomain (RF-10, RF-13, RF-14; docs/05
 * seção "Organizações"). ADMIN é o único papel com acesso — aplicado pelo
 * `authorize('ADMIN')` na rota, não aqui.
 */
export class OrganizationService {
  constructor(private readonly deps: OrganizationServiceDeps) {}

  async list(
    filters: OrganizationFilters,
    pagination: PaginationParams,
  ): Promise<Page<Organization>> {
    return this.deps.organizationRepository.list(filters, pagination);
  }

  async create(data: CreateOrganizationData): Promise<Organization> {
    return this.deps.organizationRepository.create(data);
  }

  async findById(id: string): Promise<Organization> {
    const organization = await this.deps.organizationRepository.findById(id);
    if (!organization) {
      throw new NotFoundError('NOT_FOUND', 'Organização não encontrada.');
    }
    return organization;
  }

  async findDetailById(id: string): Promise<OrganizationDetail> {
    const organization = await this.findById(id);
    const [domains, companiesPage] = await Promise.all([
      this.deps.emailDomainRepository.listByOrganization(id),
      this.deps.companyRepository.list({ organizationId: id }, { page: 1, pageSize: 100 }),
    ]);

    return { organization, domains, companies: companiesPage.items };
  }

  async update(id: string, data: UpdateOrganizationData): Promise<Organization> {
    await this.findById(id);
    return this.deps.organizationRepository.update(id, data);
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    const dependents = await this.deps.organizationRepository.countDependents(id);

    if (dependents.users > 0 || dependents.companies > 0 || dependents.processes > 0) {
      throw new ConflictError(
        'CONFLICT',
        'Não é possível excluir a organização: existem usuários, CNPJs ou processos vinculados.',
        dependents,
      );
    }

    await this.deps.organizationRepository.delete(id);
  }

  async listDomains(organizationId: string): Promise<EmailDomain[]> {
    await this.findById(organizationId);
    return this.deps.emailDomainRepository.listByOrganization(organizationId);
  }

  async createDomain(
    organizationId: string,
    input: Omit<CreateEmailDomainData, 'organizationId'>,
  ): Promise<EmailDomain> {
    await this.findById(organizationId);

    const domain = normalizeEmailDomain(input.domain);
    const existing = await this.deps.emailDomainRepository.findByDomain(domain);
    if (existing) {
      throw new ConflictError('CONFLICT', 'Este domínio já pertence a outra organização.');
    }

    return this.deps.emailDomainRepository.create({ ...input, domain, organizationId });
  }

  async deleteDomain(organizationId: string, domainId: string): Promise<void> {
    await this.findById(organizationId);

    const domain = await this.deps.emailDomainRepository.findById(domainId);
    if (!domain || domain.organizationId !== organizationId) {
      throw new NotFoundError('NOT_FOUND', 'Domínio não encontrado.');
    }

    await this.deps.emailDomainRepository.delete(domainId);
  }
}
