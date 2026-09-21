import type { CnpjLookupProvider } from '@/domain/cnpj/cnpj-lookup-provider';
import type {
  Company,
  CompanyFilters,
  CreateCompanyData,
  UpdateCompanyData,
} from '@/domain/entities/company';
import type { CompanyDocumentType } from '@/domain/enums';
import { AppError, ConflictError, NotFoundError } from '@/domain/errors/app-error';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { CompanyRepository } from '@/domain/repositories/company-repository';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';
import { classifyDocument, isValidCnpj, normalizeCnpjDigits } from '@/shared/cnpj';

export interface CompanyServiceDeps {
  companyRepository: CompanyRepository;
  organizationRepository: OrganizationRepository;
  /**
   * `null` quando `CNPJ_LOOKUP_ENABLED=false` (docs/10): a consulta responde
   * 503 e o cadastro manual segue funcionando. Modelado como `null` explícito
   * em vez de um provider no-op para que o service possa distinguir
   * "desligado por configuração" de "provedor fora do ar".
   */
  cnpjLookupProvider: CnpjLookupProvider | null;
}

export interface CreateCompanyInput {
  cnpj: string;
  legalName: string;
  tradeName?: string | null | undefined;
  organizationId: string;
}

/**
 * Resultado da consulta de CNPJ apresentado ao operador. `alreadyRegistered`
 * distingue os dados que vieram do nosso banco (empresa já cadastrada) dos que
 * vieram da Receita, para a UI poder avisar em vez de deixar o admin descobrir
 * no 409 do `POST /companies`.
 */
export interface CnpjLookupResult {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  registrationStatus: string | null;
  alreadyRegistered: boolean;
  /** Preenchido apenas quando `alreadyRegistered` é `true`. */
  companyId: string | null;
  organizationId: string | null;
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

  /**
   * Consulta os dados cadastrais de um CNPJ para autopreencher o formulário de
   * cadastro de empresa (docs/05, "Empresas / CNPJs").
   *
   * A ordem dos passos é intencional: validar os dígitos e checar o próprio
   * banco **antes** de chamar a Receita. O plano gratuito do provedor permite
   * apenas 3 consultas por minuto por IP, então gastar uma requisição com um
   * CNPJ malformado ou com uma empresa que já está cadastrada aqui
   * desperdiçaria cota que o próximo operador precisa.
   */
  async lookupCnpj(rawCnpj: string): Promise<CnpjLookupResult> {
    const cnpj = this.normalizeAndValidateCnpj(rawCnpj);

    const existing = await this.deps.companyRepository.findByCnpj(cnpj);
    if (existing) {
      return {
        cnpj,
        legalName: existing.legalName,
        tradeName: existing.tradeName,
        registrationStatus: null,
        alreadyRegistered: true,
        companyId: existing.id,
        organizationId: existing.organizationId,
      };
    }

    const provider = this.deps.cnpjLookupProvider;
    if (!provider) {
      throw new AppError(
        'CNPJ_LOOKUP_DISABLED',
        'A consulta automática de CNPJ está desabilitada. Preencha os dados manualmente.',
        503,
      );
    }

    const outcome = await provider.lookup(cnpj);

    switch (outcome.kind) {
      case 'FOUND':
        return {
          cnpj: outcome.data.cnpj,
          legalName: outcome.data.legalName,
          tradeName: outcome.data.tradeName,
          registrationStatus: outcome.data.registrationStatus,
          alreadyRegistered: false,
          companyId: null,
          organizationId: null,
        };
      case 'NOT_FOUND':
        throw new NotFoundError(
          'CNPJ_NOT_FOUND',
          'CNPJ não encontrado na base da Receita Federal.',
        );
      case 'RATE_LIMITED':
        throw new AppError(
          'CNPJ_LOOKUP_RATE_LIMITED',
          'Limite de consultas à Receita Federal atingido. Aguarde um minuto e tente novamente.',
          429,
        );
      case 'UNAVAILABLE':
        throw new AppError('CNPJ_LOOKUP_UNAVAILABLE', outcome.reason, 503);
    }
  }

  async create(input: CreateCompanyInput): Promise<Company> {
    const { cnpj, documentType } = this.normalizeAndValidateDocument(input.cnpj);

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
      documentType,
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
    const current = await this.findById(id);

    if (data.organizationId) {
      const organization = await this.deps.organizationRepository.findById(data.organizationId);
      if (!organization) {
        throw new NotFoundError('NOT_FOUND', 'Organização não encontrada.');
      }
    }

    // Conclusão de cadastro pendente (docs/13, decisão 10). Trocar o documento
    // de uma empresa já cadastrada não é permitido: processos e histórico
    // referenciam a empresa pelo que ela era; corrija criando outra.
    let documentPatch: Pick<UpdateCompanyData, 'cnpj' | 'documentType'> = {};
    if (data.cnpj !== undefined) {
      if (current.cnpj !== null) {
        throw new ConflictError(
          'COMPANY_DOCUMENT_LOCKED',
          'O CNPJ/CPF só pode ser definido em cadastro pendente.',
        );
      }
      const { cnpj, documentType } = this.normalizeAndValidateDocument(data.cnpj);
      const existing = await this.deps.companyRepository.findByCnpj(cnpj);
      if (existing && existing.id !== id) {
        throw new ConflictError('CONFLICT', 'Já existe uma empresa cadastrada com este CNPJ.');
      }
      documentPatch = { cnpj, documentType };
    }

    return this.deps.companyRepository.update(id, { ...data, ...documentPatch });
  }

  /**
   * CNPJ (14 dígitos) ou CPF (11 dígitos), com ou sem máscara (RF-12;
   * docs/13, decisão 5). O código de erro distingue os dois para a UI e
   * para o agente saberem o que corrigir.
   */
  private normalizeAndValidateDocument(rawValue: string): {
    cnpj: string;
    documentType: CompanyDocumentType;
  } {
    const classified = classifyDocument(rawValue);
    if (classified) {
      return { cnpj: classified.digits, documentType: classified.kind };
    }
    const digits = normalizeCnpjDigits(rawValue);
    if (digits.length === 11) {
      throw new AppError('INVALID_CPF', 'CPF com dígitos verificadores inválidos.', 400);
    }
    throw new AppError('INVALID_CNPJ', 'CNPJ com dígitos verificadores inválidos.', 400);
  }

  /** Aceita com ou sem máscara e devolve somente dígitos (RF-12). Só CNPJ: a consulta na Receita não cobre CPF. */
  private normalizeAndValidateCnpj(rawCnpj: string): string {
    const cnpj = normalizeCnpjDigits(rawCnpj);
    if (!isValidCnpj(cnpj)) {
      throw new AppError('INVALID_CNPJ', 'CNPJ com dígitos verificadores inválidos.', 400);
    }
    return cnpj;
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
