import type { User } from '@/domain/entities/user';
import type { AuthProvider } from '@/domain/enums';
import { AppError } from '@/domain/errors/app-error';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';
import type { UserIdentityRepository } from '@/domain/repositories/user-identity-repository';
import type { UserRepository } from '@/domain/repositories/user-repository';
import { logger } from '@/infra/logger';
import { DomainProvisioningService } from '@/services/domain-provisioning-service';
import type { IssuedTokens } from '@/services/token-issuer';
import { TokenIssuer } from '@/services/token-issuer';

export interface SocialProfile {
  provider: AuthProvider;
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export type SocialLoginResult =
  { status: 'ACTIVE'; user: User; tokens: IssuedTokens } | { status: 'PENDING' };

export interface SocialAuthServiceDeps {
  userRepository: UserRepository;
  userIdentityRepository: UserIdentityRepository;
  organizationRepository: OrganizationRepository;
  domainProvisioningService: DomainProvisioningService;
  tokenIssuer: TokenIssuer;
}

/**
 * Login social (docs/06, seção "Login social"). Reaproveita
 * `DomainProvisioningService` (mesma regra do registro local) e
 * `TokenIssuer` (mesma emissão de tokens) — a única lógica nova aqui é a
 * resolução em três passos descrita no documento.
 */
export class SocialAuthService {
  constructor(private readonly deps: SocialAuthServiceDeps) {}

  async loginOrRegister(
    profile: SocialProfile,
    context: { userAgent: string | null; ipAddress: string | null },
  ): Promise<SocialLoginResult> {
    if (!profile.emailVerified) {
      throw new AppError(
        'EMAIL_NOT_VERIFIED',
        'O provedor não confirmou que este e-mail foi verificado.',
        400,
      );
    }

    const email = profile.email.trim().toLowerCase();

    // Passo 1: UserIdentity já vinculada a este provedor.
    const existingIdentity = await this.deps.userIdentityRepository.findByProvider(
      profile.provider,
      profile.providerUserId,
    );
    if (existingIdentity) {
      const user = await this.deps.userRepository.findById(existingIdentity.userId);
      if (!user) {
        // Identidade órfã (usuário excluído por fora) — trata como se não existisse.
        logger.warn(
          { userId: existingIdentity.userId, provider: profile.provider },
          'UserIdentity aponta para usuário inexistente',
        );
      } else {
        return this.resultFor(user, context);
      }
    }

    // Passo 2: usuário já existe com este e-mail (local ou outro provedor) —
    // vincula uma UserIdentity nova em vez de duplicar a conta (RF-09).
    const existingUser = await this.deps.userRepository.findByEmail(email);
    if (existingUser) {
      await this.deps.userIdentityRepository.create({
        userId: existingUser.id,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      });
      return this.resultFor(existingUser, context);
    }

    // Passo 3: nenhum dos dois — cria usuário novo com o mesmo provisionamento
    // por domínio usado no registro local.
    const provisioning = await this.deps.domainProvisioningService.resolve(email);
    const isActive = provisioning.organizationId !== null && provisioning.autoApprove;

    const user = await this.deps.userRepository.create({
      name: profile.name,
      email,
      // Contas criadas por social não têm senha local (docs/06).
      passwordHash: null,
      role: provisioning.role,
      status: isActive ? 'ACTIVE' : 'PENDING',
      accessScope: provisioning.accessScope,
      organizationId: provisioning.organizationId,
    });

    await this.deps.userIdentityRepository.create({
      userId: user.id,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
    });

    return this.resultFor(user, context);
  }

  private async resultFor(
    user: User,
    context: { userAgent: string | null; ipAddress: string | null },
  ): Promise<SocialLoginResult> {
    // `status = PENDING` bloqueia a emissão de token mesmo no fluxo social
    // (docs/06). DISABLED/REJECTED usam o mesmo erro do login local, para
    // que o callback redirecione com `?status=error` em vez de mascarar
    // como pendente.
    if (user.status === 'PENDING') {
      return { status: 'PENDING' };
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_DISABLED', 'Conta desativada.', 403);
    }

    const tokens = await this.deps.tokenIssuer.issue(user, context);
    return { status: 'ACTIVE', user, tokens };
  }
}
