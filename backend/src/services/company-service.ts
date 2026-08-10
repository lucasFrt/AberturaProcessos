import type {
  Company,
  CompanyFilters,
  CreateCompanyData,
  UpdateCompanyData,
} from '@/domain/entities/company';
import { AppError, ConflictError, NotFoundError } from '@/domain/errors/app-error';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { CompanyRepository } from '@/domain/repositories/company-repository';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';
import { isValidCnpj, normalizeCnpjDigits } from '@/shared/cnpj';

export interface CompanyServiceDeps {
  companyRepository: CompanyRepository;
  organizationRepository: OrganizationRepository;
}

export interface CreateCompanyInput {
  cnpj: string;
  legalName: string;
  tradeName?: string | null | undefined;
  organizationId: string;
}

/**
 * CRUD de Company com validação de CNPJ (RF-11, RF-12; docs/05 seção
 * "Empresas / CNPJs"). O CNPJ é aceito com ou sem máscara e persistido
 * apenas com dígitos.
 */
export class CompanyService {
  constructor(private readonly deps: CompanyServiceDeps) {}

  async list(filters: CompanyFilters, pagination: PaginationParams): Promise<Page<Company>> {
    const normalizedFilters: CompanyFilters =
      filters.q !== undefined ? { ...filters, q: filters.q.trim() } : filters;
    return this.deps.companyRepository.list(normalizedFilters, pagination);
  }

  async create(input: CreateCompanyInput): Promise<Company> {
    const cnpj = normalizeCnpjDigits(input.cnpj);
    if (!isValidCnpj(cnpj)) {
      throw new AppError('INVALID_CNPJ', 'CNPJ com dígitos verificadores inválidos.', 400);
    }

    const organization = await this.deps.organizationRepository.findById(input.organizationId);
    if (!organization) {
      throw new NotFoundError('NOT_FOUND', 'Organização não encontrada.');
    }

    const existing = await this.deps.companyRepository.findByCnpj(cnpj);
    if (existing) {
      throw new ConflictError('CONFLICT', 'Já existe uma empresa cadastrada com este CNPJ.');
    }

    const data: CreateCompanyData = {
      cnpj,
      legalName: input.legalName,
      tradeName: input.tradeName ?? null,
      organizationId: input.organizationId,
    };
    return this.deps.companyRepository.create(data);
  }

  async findById(id: string): Promise<Company> {
    const company = await this.deps.companyRepository.findById(id);
    if (!company) {
      throw new NotFoundError('NOT_FOUND', 'Empresa não encontrada.');
    }
    return company;
  }

  async update(id: string, data: UpdateCompanyData): Promise<Company> {
    await this.findById(id);

    if (data.organizationId) {
      const organization = await this.deps.organizationRepository.findById(data.organizationId);
      if (!organization) {
        throw new NotFoundError('NOT_FOUND', 'Organização não encontrada.');
      }
    }

    return this.deps.companyRepository.update(id, data);
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    const linkedProcesses = await this.deps.companyRepository.countLinkedProcesses(id);

    if (linkedProcesses > 0) {
      throw new ConflictError(
        'CONFLICT',
        'Não é possível excluir a empresa: existem processos vinculados.',
        { processCount: linkedProcesses },
      );
    }

    await this.deps.companyRepository.delete(id);
  }
}
