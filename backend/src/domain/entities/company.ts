import type { CompanyDocumentType } from '@/domain/enums';

export interface Company {
  id: string;
  /**
   * Somente dígitos: 14 (CNPJ) ou 11 (CPF) — ver `documentType`. `null` =
   * cadastro pendente: criada pelo intake a partir do domínio do solicitante
   * (docs/13, decisão 10); completa-se pela tela de empresas.
   */
  cnpj: string | null;
  documentType: CompanyDocumentType | null;
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
  cnpj: string | null;
  documentType: CompanyDocumentType | null;
  legalName: string;
  tradeName: string | null;
  organizationId: string;
}

export interface UpdateCompanyData {
  /** Conclusão de cadastro pendente: o service só permite quando `cnpj` era `null`. */
  cnpj?: string | undefined;
  documentType?: CompanyDocumentType | undefined;
  legalName?: string | undefined;
  tradeName?: string | null | undefined;
  isActive?: boolean | undefined;
  organizationId?: string | undefined;
}

export interface CompanyFilters {
  q?: string | undefined;
  organizationId?: string | undefined;
  isActive?: boolean | undefined;
  /** `true` = só cadastros pendentes (`cnpj IS NULL`); `false` = só completos. */
  pendingRegistration?: boolean | undefined;
}
