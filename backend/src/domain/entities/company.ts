import type { CompanyDocumentType } from '@/domain/enums';

export interface Company {
  id: string;
  /** Somente dígitos: 14 (CNPJ) ou 11 (CPF) — ver `documentType`. */
  cnpj: string;
  documentType: CompanyDocumentType;
  legalName: string;
  tradeName: string | null;
  organizationId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Só populado por `CompanyRepository.list()` (docs/05, "Empresas / CNPJs"):
   * a tela de administração precisa exibir o nome da organização na tabela
   * sem uma consulta extra por linha. `findById`/`create`/`update` não
   * preenchem este campo — ele permanece `undefined`.
   */
  organization?: { id: string; name: string };
}

export interface CreateCompanyData {
  cnpj: string;
  documentType: CompanyDocumentType;
  legalName: string;
  tradeName: string | null;
  organizationId: string;
}

export interface UpdateCompanyData {
  legalName?: string | undefined;
  tradeName?: string | null | undefined;
  isActive?: boolean | undefined;
  organizationId?: string | undefined;
}

export interface CompanyFilters {
  q?: string | undefined;
  organizationId?: string | undefined;
  isActive?: boolean | undefined;
}
