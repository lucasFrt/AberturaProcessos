import type { User } from '@/domain/entities/user';
import type { MeResult } from '@/services/auth-service';

/**
 * Monta os DTOs de resposta campo a campo — nunca `...user` (docs/06,
 * checklist de segurança). É o mecanismo que impede `passwordHash` de
 * escapar para o cliente.
 */

interface UserSummaryDto {
  id: string;
  name: string;
  role: string;
}

export function presentUserSummary(user: User): UserSummaryDto {
  return { id: user.id, name: user.name, role: user.role };
}

interface LoginResponseDto {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    organization: { id: string; name: string } | null;
  };
}

export function presentLoginResponse(input: {
  user: User;
  accessToken: string;
  expiresInSeconds: number;
  organizationName: string | null;
}): LoginResponseDto {
  const { user, accessToken, expiresInSeconds, organizationName } = input;

  return {
    accessToken,
    expiresIn: expiresInSeconds,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organization:
        user.organizationId && organizationName
          ? { id: user.organizationId, name: organizationName }
          : null,
    },
  };
}

interface MeResponseDto {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  avatarUrl: string | null;
  organization: { id: string; name: string; isInternal: boolean } | null;
  accessScope: string;
  companies: Array<{ id: string; cnpj: string | null; legalName: string }>;
  permissions: readonly string[];
}

export function presentMeResponse(result: MeResult): MeResponseDto {
  const { user, organization, companies, permissions } = result;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarUrl,
    organization: organization
      ? { id: organization.id, name: organization.name, isInternal: organization.isInternal }
      : null,
    accessScope: user.accessScope,
    companies: companies.map((company) => ({
      id: company.id,
      cnpj: company.cnpj,
      legalName: company.legalName,
    })),
    permissions,
  };
}
