export interface Company {
  id: string;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  organizationId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCompanyData {
  cnpj: string;
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
