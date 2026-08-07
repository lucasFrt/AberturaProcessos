import type { AccessScope } from '@/domain/entities/access-scope';
import type { User } from '@/domain/entities/user';
import type { UserRepository } from '@/domain/repositories/user-repository';

/**
 * Resolve o AccessScope de um usuário (docs/06, seção "Resolução do
 * escopo"). Chamado a cada requisição autenticada — nunca fica guardado no
 * JWT, para que mudanças de acesso feitas pelo ADMIN valham imediatamente.
 */
export class AccessScopeResolver {
  constructor(private readonly userRepository: UserRepository) {}

  async resolve(user: User): Promise<AccessScope> {
    if (user.role === 'OPERATIONAL' || user.role === 'ADMIN') {
      return { kind: 'ALL' };
    }

    if (user.accessScope === 'COMPANIES') {
      const companyIds = await this.userRepository.listCompanyIdsByUser(user.id);
      return { kind: 'COMPANIES', companyIds };
    }

    // Falha fechada: sem organização, o escopo resolve para uma lista vazia.
    if (!user.organizationId) {
      return { kind: 'COMPANIES', companyIds: [] };
    }

    const companyIds = await this.userRepository.listActiveCompanyIdsByOrganization(
      user.organizationId,
    );
    return { kind: 'COMPANIES', companyIds };
  }
}
