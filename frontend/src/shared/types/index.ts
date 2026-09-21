/** Tipos transversais, compartilhados por múltiplas features. */

export type Role = 'CLIENT' | 'OPERATIONAL' | 'ADMIN';

export type UserStatus = 'PENDING' | 'ACTIVE' | 'DISABLED' | 'REJECTED';

export type AccessScopeKind = 'ORGANIZATION' | 'COMPANIES';

export interface OrganizationSummary {
  id: string;
  name: string;
  isInternal: boolean;
}

export interface CompanySummary {
  id: string;
  /** `null` = cadastro pendente (docs/13, decisão 10). */
  cnpj: string | null;
  legalName: string;
}

/** Espelha `GET /auth/me` (docs/05). */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  avatarUrl: string | null;
  organization: OrganizationSummary | null;
  accessScope: AccessScopeKind;
  companies: CompanySummary[];
  permissions: readonly string[];
}

/** Envelope de coleção paginada (docs/05, seção "Convenções"). */
export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/** Envelope de erro padrão da API (docs/05). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; message: string }>;
    requestId?: string;
  };
}
