import type { User } from '@/domain/entities/user';

let counter = 0;

export function buildUser(overrides: Partial<User> = {}): User {
  counter += 1;
  const now = new Date();

  return {
    id: `user-${counter}`,
    name: 'Usuário de Teste',
    email: `usuario${counter}@teste.com`,
    passwordHash: null,
    role: 'CLIENT',
    status: 'ACTIVE',
    accessScope: 'ORGANIZATION',
    organizationId: null,
    avatarUrl: null,
    lastLoginAt: null,
    approvedAt: null,
    approvedById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
