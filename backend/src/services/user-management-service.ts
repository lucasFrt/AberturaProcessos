import type { Company } from '@/domain/entities/company';
import type { UpdateUserData, User } from '@/domain/entities/user';
import type { AccessScopeKind, Role } from '@/domain/enums';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/domain/errors/app-error';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { CompanyRepository } from '@/domain/repositories/company-repository';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';
import type { RefreshTokenRepository } from '@/domain/repositories/refresh-token-repository';
import type { UserIdentityRepository } from '@/domain/repositories/user-identity-repository';
import type { UserFilters, UserRepository } from '@/domain/repositories/user-repository';

export interface UserManagementServiceDeps {
  userRepository: UserRepository;
  userIdentityRepository: UserIdentityRepository;
  organizationRepository: OrganizationRepository;
  companyRepository: CompanyRepository;
  refreshTokenRepository: RefreshTokenRepository;
}

export interface ApproveUserInput {
  role: Role;
  organizationId: string;
  accessScope: AccessScopeKind;
  companyIds?: string[] | undefined;
}

export interface RejectUserInput {
  reason?: string | undefined;
}

export interface UpdateUserInput {
  name?: string | undefined;
  role?: Role | undefined;
  status?: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'REJECTED' | undefined;
  organizationId?: string | undefined;
  accessScope?: AccessScopeKind | undefined;
}

export interface UserDetail {
  user: User;
  identityProviders: string[];
  companies: Company[];
}

/**
 * Gestão de usuários por ADMIN (RF-07, RF-08; docs/05 seção "Usuários").
 * Guards de auto-rebaixamento/auto-desativação e do "ao menos um ADMIN
 * ativo" vivem aqui, não na rota — são regra de negócio, não de HTTP.
 */
export class UserManagementService {
  constructor(private readonly deps: UserManagementServiceDeps) {}

  async list(filters: UserFilters, pagination: PaginationParams): Promise<Page<User>> {
    return this.deps.userRepository.list(filters, pagination);
  }

  async listPending(pagination: PaginationParams): Promise<Page<User>> {
    // "Atalho para status=PENDING, ordenado por createdAt asc" (docs/05) —
    // a ordenação já é a padrão do repositório.
    return this.deps.userRepository.list({ status: 'PENDING' }, pagination);
  }

  async listOperational(): Promise<User[]> {
    return this.deps.userRepository.listActiveByRoles(['OPERATIONAL', 'ADMIN']);
  }

  async findById(id: string): Promise<User> {
    const user = await this.deps.userRepository.findById(id);
    if (!user) {
      throw new NotFoundError('NOT_FOUND', 'Usuário não encontrado.');
    }
    return user;
  }

  async findDetailById(id: string): Promise<UserDetail> {
    const user = await this.findById(id);
    const [identities, companyIds] = await Promise.all([
      this.deps.userIdentityRepository.listByUserId(id),
      this.deps.userRepository.listCompanyIdsByUser(id),
    ]);
    const companies =
      companyIds.length > 0 ? await this.deps.companyRepository.findManyByIds(companyIds) : [];

    return {
      user,
      identityProviders: identities.map((identity) => identity.provider),
      companies,
    };
  }

  async approve(id: string, actorId: string, input: ApproveUserInput): Promise<User> {
    const user = await this.findById(id);
    if (user.status !== 'PENDING') {
      throw new ConflictError('CONFLICT', 'Somente contas pendentes podem ser aprovadas.');
    }

    const organization = await this.deps.organizationRepository.findById(input.organizationId);
    if (!organization) {
      throw new NotFoundError('NOT_FOUND', 'Organização não encontrada.');
    }

    if (input.accessScope === 'COMPANIES' && input.companyIds && input.companyIds.length > 0) {
      const companies = await this.deps.companyRepository.findManyByIds(input.companyIds);
      if (companies.length !== input.companyIds.length) {
        throw new ValidationError('Um ou mais CNPJs informados não existem.');
      }
    }

    const updated = await this.deps.userRepository.update(id, {
      status: 'ACTIVE',
      role: input.role,
      organizationId: input.organizationId,
      accessScope: input.accessScope,
      approvedAt: new Date(),
      approvedById: actorId,
    });

    if (input.accessScope === 'COMPANIES') {
      await this.deps.userRepository.replaceCompanyAccess(id, input.companyIds ?? []);
    }

    return updated;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reason é aceito no contrato (docs/05) para futura auditoria/e-mail, sem uso interno ainda
  async reject(id: string, _input: RejectUserInput): Promise<User> {
    const user = await this.findById(id);
    if (user.status !== 'PENDING') {
      throw new ConflictError('CONFLICT', 'Somente contas pendentes podem ser rejeitadas.');
    }

    return this.deps.userRepository.update(id, { status: 'REJECTED' });
  }

  async update(id: string, actorId: string, input: UpdateUserInput): Promise<User> {
    const user = await this.findById(id);
    const isSelf = id === actorId;

    // ADMIN não pode se rebaixar nem se desativar (docs/05, "Regras de guarda").
    if (isSelf && input.role && input.role !== 'ADMIN' && user.role === 'ADMIN') {
      throw new ConflictError(
        'CONFLICT',
        'Você não pode rebaixar o próprio papel de administrador.',
      );
    }
    if (isSelf && input.status && input.status !== 'ACTIVE' && user.status === 'ACTIVE') {
      throw new ConflictError('CONFLICT', 'Você não pode desativar a própria conta.');
    }

    // Mantém ao menos um ADMIN ativo no sistema, mesmo quando a ação não é
    // sobre a própria conta.
    const losesAdmin =
      user.role === 'ADMIN' &&
      user.status === 'ACTIVE' &&
      ((input.role && input.role !== 'ADMIN') || (input.status && input.status !== 'ACTIVE'));
    if (losesAdmin) {
      const remainingAdmins = await this.deps.userRepository.countActiveAdmins(id);
      if (remainingAdmins === 0) {
        throw new ConflictError(
          'CONFLICT',
          'É necessário manter ao menos um administrador ativo no sistema.',
        );
      }
    }

    if (input.organizationId) {
      const organization = await this.deps.organizationRepository.findById(input.organizationId);
      if (!organization) {
        throw new NotFoundError('NOT_FOUND', 'Organização não encontrada.');
      }
    }

    const data: UpdateUserData = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
      ...(input.accessScope !== undefined ? { accessScope: input.accessScope } : {}),
    };

    const updated = await this.deps.userRepository.update(id, data);

    // Desativar revoga sessões ativas (RF-08, docs/05).
    if (input.status === 'DISABLED') {
      await this.deps.refreshTokenRepository.revokeAllByUserId(id);
    }

    return updated;
  }

  async replaceCompanies(id: string, companyIds: string[]): Promise<User> {
    const user = await this.findById(id);
    if (user.accessScope !== 'COMPANIES') {
      throw new AppError(
        'CONFLICT',
        'O usuário precisa ter accessScope = COMPANIES para ter CNPJs definidos explicitamente.',
        409,
      );
    }

    if (companyIds.length > 0) {
      const companies = await this.deps.companyRepository.findManyByIds(companyIds);
      if (companies.length !== companyIds.length) {
        throw new ValidationError('Um ou mais CNPJs informados não existem.');
      }
    }

    await this.deps.userRepository.replaceCompanyAccess(id, companyIds);
    return user;
  }
}
