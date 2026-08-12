import type { User } from '@/domain/entities/user';
import { getRefreshTokenFromCookie } from '@/http/controllers/auth-cookies';
import { presentLoginResponse, presentMeResponse } from '@/http/presenters/auth-presenter';
import { presentCollection } from '@/http/presenters/pagination-presenter';
import { presentUser, presentUserDetail } from '@/http/presenters/user-management-presenter';

/**
 * Cobre ramos dos presenters (docs/09, cobertura de `src/http/presenters`
 * e `src/http/controllers`) não exercitados pelo caminho feliz dos testes
 * de integração: organização ausente, cookie ausente/malformado,
 * `pageSize` zero na paginação.
 */
function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Usuário Teste',
    email: 'usuario@teste.com.br',
    passwordHash: null,
    role: 'CLIENT',
    status: 'ACTIVE',
    accessScope: 'ORGANIZATION',
    organizationId: 'org-1',
    avatarUrl: null,
    lastLoginAt: null,
    approvedAt: null,
    approvedById: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('auth-presenter', () => {
  it('presentLoginResponse retorna organization=null quando organizationId é null', () => {
    const user = buildUser({ organizationId: null });
    const dto = presentLoginResponse({
      user,
      accessToken: 'token',
      expiresInSeconds: 900,
      organizationName: null,
    });
    expect(dto.user.organization).toBeNull();
  });

  it('presentLoginResponse retorna organization=null quando organizationName é null (mesmo com id)', () => {
    const user = buildUser({ organizationId: 'org-1' });
    const dto = presentLoginResponse({
      user,
      accessToken: 'token',
      expiresInSeconds: 900,
      organizationName: null,
    });
    expect(dto.user.organization).toBeNull();
  });

  it('presentLoginResponse monta organization quando id e nome existem', () => {
    const user = buildUser({ organizationId: 'org-1' });
    const dto = presentLoginResponse({
      user,
      accessToken: 'token',
      expiresInSeconds: 900,
      organizationName: 'Organização Teste',
    });
    expect(dto.user.organization).toEqual({ id: 'org-1', name: 'Organização Teste' });
  });

  it('presentMeResponse retorna organization=null quando não há organização', () => {
    const dto = presentMeResponse({
      user: buildUser(),
      organization: null,
      companies: [],
      scope: { kind: 'ALL' },
      permissions: [],
    });
    expect(dto.organization).toBeNull();
  });

  it('presentMeResponse monta organization quando presente', () => {
    const dto = presentMeResponse({
      user: buildUser(),
      organization: {
        id: 'org-1',
        name: 'Org',
        isInternal: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      companies: [],
      scope: { kind: 'ALL' },
      permissions: ['CREATE_PROCESS'],
    });
    expect(dto.organization).toEqual({ id: 'org-1', name: 'Org', isInternal: true });
  });
});

describe('user-management-presenter', () => {
  it('presentUser converte lastLoginAt/approvedAt null para null', () => {
    const dto = presentUser(buildUser({ lastLoginAt: null, approvedAt: null }));
    expect(dto.lastLoginAt).toBeNull();
    expect(dto.approvedAt).toBeNull();
  });

  it('presentUser converte lastLoginAt/approvedAt presentes para ISO string', () => {
    const date = new Date('2026-02-01T10:00:00Z');
    const dto = presentUser(buildUser({ lastLoginAt: date, approvedAt: date }));
    expect(dto.lastLoginAt).toBe(date.toISOString());
    expect(dto.approvedAt).toBe(date.toISOString());
  });

  it('presentUserDetail mapeia companies vazias', () => {
    const dto = presentUserDetail({
      user: buildUser(),
      identityProviders: ['LOCAL'],
      companies: [],
    });
    expect(dto.companies).toEqual([]);
    expect(dto.identityProviders).toEqual(['LOCAL']);
  });
});

describe('pagination-presenter', () => {
  it('presentCollection calcula totalPages normalmente quando pageSize > 0', () => {
    const dto = presentCollection({ items: [1, 2], total: 5 }, { page: 1, pageSize: 2 }, (x) => x);
    expect(dto.meta.totalPages).toBe(3);
  });

  it('presentCollection retorna totalPages=0 quando pageSize é 0 (evita divisão por zero)', () => {
    const dto = presentCollection({ items: [], total: 5 }, { page: 1, pageSize: 0 }, (x) => x);
    expect(dto.meta.totalPages).toBe(0);
  });
});

describe('auth-cookies: getRefreshTokenFromCookie', () => {
  it('retorna null quando cookies é null ou não é objeto', () => {
    expect(getRefreshTokenFromCookie(null)).toBeNull();
    expect(getRefreshTokenFromCookie('nao-e-objeto')).toBeNull();
  });

  it('retorna null quando o valor do cookie não é string', () => {
    expect(getRefreshTokenFromCookie({ refreshToken: 123 })).toBeNull();
  });

  it('retorna o valor quando presente e é string', () => {
    expect(getRefreshTokenFromCookie({ refreshToken: 'abc' })).toBe('abc');
  });
});
