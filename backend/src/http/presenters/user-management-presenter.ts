import type { Company } from '@/domain/entities/company';
import type { User } from '@/domain/entities/user';
import type { UserDetail } from '@/services/user-management-service';

interface UserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  accessScope: string;
  organizationId: string | null;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Monta o DTO campo a campo — nunca `...user` (nunca vaza `passwordHash`). */
export function presentUser(user: User): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    accessScope: user.accessScope,
    organizationId: user.organizationId,
    avatarUrl: user.avatarUrl,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    approvedAt: user.approvedAt ? user.approvedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

interface CompanySummaryDto {
  id: string;
  cnpj: string | null;
  legalName: string;
}

function presentCompanySummary(company: Company): CompanySummaryDto {
  return { id: company.id, cnpj: company.cnpj, legalName: company.legalName };
}

interface UserDetailDto extends UserDto {
  identityProviders: string[];
  companies: CompanySummaryDto[];
}

export function presentUserDetail(detail: UserDetail): UserDetailDto {
  return {
    ...presentUser(detail.user),
    identityProviders: detail.identityProviders,
    companies: detail.companies.map(presentCompanySummary),
  };
}

interface OperationalUserDto {
  id: string;
  name: string;
  role: string;
}

export function presentOperationalUser(user: User): OperationalUserDto {
  return { id: user.id, name: user.name, role: user.role };
}
