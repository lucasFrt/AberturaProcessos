import type { AccessScope } from '@/domain/entities/access-scope';
import type { Company } from '@/domain/entities/company';
import type { Organization } from '@/domain/entities/organization';
import type { User } from '@/domain/entities/user';
import { AppError, UnauthenticatedError } from '@/domain/errors/app-error';
import { getPermissionsForRole } from '@/domain/permissions';
import { EMAIL_JOBS } from '@/domain/queue/queue-provider';
import type { QueueProvider } from '@/domain/queue/queue-provider';
import type { CompanyRepository } from '@/domain/repositories/company-repository';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';
import type { RefreshTokenRepository } from '@/domain/repositories/refresh-token-repository';
import type { UserIdentityRepository } from '@/domain/repositories/user-identity-repository';
import type { UserRepository } from '@/domain/repositories/user-repository';
import { logger } from '@/infra/logger';
import type { PasswordHasher } from '@/infra/security/password-hasher';
import { hashRefreshToken } from '@/infra/security/refresh-token-generator';
import type { TokenService } from '@/infra/security/token-service';
import { AccessScopeResolver } from '@/services/access-scope-resolver';
import { DomainProvisioningService } from '@/services/domain-provisioning-service';
import { TokenIssuer } from '@/services/token-issuer';
import type { IssuedTokens } from '@/services/token-issuer';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface RefreshInput {
  refreshToken: string;
  userAgent: string | null;
  ipAddress: string | null;
}

export type RegisterResult =
  { status: 'ACTIVE'; user: User; tokens: IssuedTokens } | { status: 'PENDING' };

export interface MeResult {
  user: User;
  organization: Organization | null;
  companies: Company[];
  scope: AccessScope;
  permissions: readonly string[];
}

export interface AuthServiceDeps {
  userRepository: UserRepository;
  userIdentityRepository: UserIdentityRepository;
  refreshTokenRepository: RefreshTokenRepository;
  organizationRepository: OrganizationRepository;
  companyRepository: CompanyRepository;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  domainProvisioningService: DomainProvisioningService;
  accessScopeResolver: AccessScopeResolver;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  /** Opcional pelo mesmo motivo de `ProcessService.queueProvider` (docs/07). */
  queueProvider?: QueueProvider | undefined;
}

/**
 * Regra de negócio de autenticação local (docs/06). Login social
 * (Tarefa 5) vive em SocialAuthService, reaproveitando
 * DomainProvisioningService e a emissão de tokens daqui.
 */
export class AuthService {
  private readonly tokenIssuer: TokenIssuer;

  constructor(private readonly deps: AuthServiceDeps) {
    this.tokenIssuer = new TokenIssuer({
      tokenService: deps.tokenService,
      refreshTokenRepository: deps.refreshTokenRepository,
      accessTokenTtl: deps.accessTokenTtl,
      refreshTokenTtlDays: deps.refreshTokenTtlDays,
    });
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const email = input.email.trim().toLowerCase();

    const existing = await this.deps.userRepository.findByEmail(email);
    if (existing) {
      throw new AppError('CONFLICT', 'Já existe uma conta com este e-mail.', 409);
    }

    const provisioning = await this.deps.domainProvisioningService.resolve(email);
    const passwordHash = await this.deps.passwordHasher.hash(input.password);
    const isActive = provisioning.organizationId !== null && provisioning.autoApprove;

    const user = await this.deps.userRepository.create({
      name: input.name,
      email,
      passwordHash,
      role: provisioning.role,
      status: isActive ? 'ACTIVE' : 'PENDING',
      accessScope: provisioning.accessScope,
      organizationId: provisioning.organizationId,
    });

    await this.deps.userIdentityRepository.create({
      userId: user.id,
      provider: 'LOCAL',
      providerUserId: email,
    });

    if (!isActive) {
      await this.enqueuePendingApprovalEmail(user);
      return { status: 'PENDING' };
    }

    const tokens = await this.tokenIssuer.issue(user, input);
    return { status: 'ACTIVE', user, tokens };
  }

  /** RF-52: avisa os administradores de um cadastro novo aguardando aprovação. */
  private async enqueuePendingApprovalEmail(user: User): Promise<void> {
    if (!this.deps.queueProvider) return;

    try {
      await this.deps.queueProvider.enqueueEmail({
        name: EMAIL_JOBS.USER_PENDING_APPROVAL,
        payload: {
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          provider: 'LOCAL',
          occurredAt: new Date().toISOString(),
        },
      });
    } catch {
      // RF-51: mesma garantia de moveStage — nunca propaga.
    }
  }

  async login(input: LoginInput): Promise<{ user: User; tokens: IssuedTokens }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.deps.userRepository.findByEmail(email);

    // Sem revelar se o e-mail existe: mesmo tempo de resposta nos dois casos
    // (docs/06, seção "Senhas").
    const passwordHash = user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinva';
    const passwordMatches = await this.deps.passwordHasher.compare(input.password, passwordHash);

    if (!user || !user.passwordHash || !passwordMatches) {
      throw new AppError('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.', 401);
    }

    if (user.status === 'PENDING') {
      throw new AppError('ACCOUNT_PENDING', 'Conta aguardando aprovação de um administrador.', 403);
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_DISABLED', 'Conta desativada.', 403);
    }

    await this.deps.userRepository.update(user.id, { lastLoginAt: new Date() });

    const tokens = await this.tokenIssuer.issue(user, input);
    return { user, tokens };
  }

  async refresh(input: RefreshInput): Promise<{ user: User; tokens: IssuedTokens }> {
    const tokenHash = hashRefreshToken(input.refreshToken);
    const stored = await this.deps.refreshTokenRepository.findByTokenHash(tokenHash);

    if (!stored) {
      throw new UnauthenticatedError();
    }

    if (stored.revokedAt) {
      // Reuso de token já revogado indica vazamento (docs/06): revoga toda
      // a família de tokens do usuário.
      logger.warn(
        { userId: stored.userId, ipAddress: input.ipAddress },
        'Reuso de refresh token revogado detectado; revogando toda a família',
      );
      await this.deps.refreshTokenRepository.revokeAllByUserId(stored.userId);
      throw new UnauthenticatedError();
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthenticatedError();
    }

    const user = await this.deps.userRepository.findById(stored.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthenticatedError();
    }

    await this.deps.refreshTokenRepository.markRevoked(stored.id);
    const tokens = await this.tokenIssuer.issue(user, input);
    return { user, tokens };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    const stored = await this.deps.refreshTokenRepository.findByTokenHash(tokenHash);
    if (stored && !stored.revokedAt) {
      await this.deps.refreshTokenRepository.markRevoked(stored.id);
    }
  }

  async me(userId: string): Promise<MeResult> {
    const user = await this.deps.userRepository.findById(userId);
    if (!user) {
      throw new UnauthenticatedError();
    }

    const scope = await this.deps.accessScopeResolver.resolve(user);
    const organization = user.organizationId
      ? await this.deps.organizationRepository.findById(user.organizationId)
      : null;
    const companies =
      scope.kind === 'COMPANIES'
        ? await this.deps.companyRepository.findManyByIds(scope.companyIds)
        : [];

    return {
      user,
      organization,
      companies,
      scope,
      permissions: getPermissionsForRole(user.role),
    };
  }
}
