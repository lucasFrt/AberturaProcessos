import { FakeTokenService } from '../helpers/fakes/fake-token-service';
import { InMemoryEmailDomainRepository } from '../helpers/fakes/in-memory-email-domain-repository';
import { InMemoryOrganizationRepository } from '../helpers/fakes/in-memory-organization-repository';
import { InMemoryRefreshTokenRepository } from '../helpers/fakes/in-memory-refresh-token-repository';
import { InMemoryUserIdentityRepository } from '../helpers/fakes/in-memory-user-identity-repository';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import { DomainProvisioningService } from '@/services/domain-provisioning-service';
import type { SocialProfile } from '@/services/social-auth-service';
import { SocialAuthService } from '@/services/social-auth-service';
import { TokenIssuer } from '@/services/token-issuer';

function buildContext(): {
  service: SocialAuthService;
  userRepository: InMemoryUserRepository;
  userIdentityRepository: InMemoryUserIdentityRepository;
  emailDomainRepository: InMemoryEmailDomainRepository;
  organizationRepository: InMemoryOrganizationRepository;
} {
  const userRepository = new InMemoryUserRepository();
  const userIdentityRepository = new InMemoryUserIdentityRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const emailDomainRepository = new InMemoryEmailDomainRepository();
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();

  const tokenIssuer = new TokenIssuer({
    tokenService: new FakeTokenService(),
    refreshTokenRepository,
    accessTokenTtl: '15m',
    refreshTokenTtlDays: 7,
  });

  const service = new SocialAuthService({
    userRepository,
    userIdentityRepository,
    organizationRepository,
    domainProvisioningService: new DomainProvisioningService(emailDomainRepository),
    tokenIssuer,
  });

  return {
    service,
    userRepository,
    userIdentityRepository,
    emailDomainRepository,
    organizationRepository,
  };
}

const context = { userAgent: 'jest', ipAddress: '127.0.0.1' };

function googleProfile(overrides: Partial<SocialProfile> = {}): SocialProfile {
  return {
    provider: 'GOOGLE',
    providerUserId: 'google-123',
    email: 'ana@opusce.com.br',
    emailVerified: true,
    name: 'Ana Souza',
    ...overrides,
  };
}

/**
 * Tarefa 5, critérios de aceite (docs/12): resolução em três passos do
 * login social + provisionamento por domínio reaproveitado do registro
 * local. Testado isolado do Passport (perfil passado como argumento
 * direto), como orientado no prompt da tarefa.
 */
describe('SocialAuthService', () => {
  it('cria usuário ACTIVE no papel do domínio quando o domínio é conhecido e autoApprove=true', async () => {
    const { service, emailDomainRepository, organizationRepository, userRepository } =
      buildContext();
    organizationRepository.items.push({
      id: 'org-1',
      name: 'Opusce',
      isInternal: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    emailDomainRepository.items.push({
      id: 'domain-1',
      domain: 'opusce.com.br',
      organizationId: 'org-1',
      defaultRole: 'OPERATIONAL',
      autoApprove: true,
      createdAt: new Date(),
    });

    const result = await service.loginOrRegister(googleProfile(), context);

    expect(result.status).toBe('ACTIVE');
    if (result.status === 'ACTIVE') {
      expect(result.user.role).toBe('OPERATIONAL');
      expect(result.user.organizationId).toBe('org-1');
      expect(result.user.passwordHash).toBeNull();
      expect(result.tokens.accessToken).toBeTruthy();
    }

    const identity = await userRepository.findByEmail('ana@opusce.com.br');
    expect(identity?.status).toBe('ACTIVE');
  });

  it('cria usuário PENDING sem token quando o domínio é desconhecido', async () => {
    const { service } = buildContext();

    const result = await service.loginOrRegister(
      googleProfile({ email: 'bruno@dominio-desconhecido.com', providerUserId: 'google-456' }),
      context,
    );

    expect(result).toEqual({ status: 'PENDING' });
  });

  it('vincula UserIdentity nova a um e-mail já existente em vez de duplicar o usuário', async () => {
    const {
      service,
      userRepository,
      userIdentityRepository,
      emailDomainRepository,
      organizationRepository,
    } = buildContext();
    organizationRepository.items.push({
      id: 'org-1',
      name: 'Cliente X',
      isInternal: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    emailDomainRepository.items.push({
      id: 'domain-1',
      domain: 'clientex.com.br',
      organizationId: 'org-1',
      defaultRole: 'CLIENT',
      autoApprove: true,
      createdAt: new Date(),
    });

    // Usuário já existe (conta local, por exemplo).
    const existingUser = await userRepository.create({
      name: 'Diana',
      email: 'diana@clientex.com.br',
      passwordHash: 'hash-local',
      role: 'CLIENT',
      status: 'ACTIVE',
      accessScope: 'ORGANIZATION',
      organizationId: 'org-1',
    });

    const result = await service.loginOrRegister(
      googleProfile({ email: 'diana@clientex.com.br', providerUserId: 'google-789' }),
      context,
    );

    expect(result.status).toBe('ACTIVE');
    if (result.status === 'ACTIVE') {
      expect(result.user.id).toBe(existingUser.id);
    }

    // Não duplicou o usuário.
    expect(
      userRepository.items.filter((user) => user.email === 'diana@clientex.com.br'),
    ).toHaveLength(1);

    // Ganhou uma UserIdentity nova vinculando o provedor Google.
    const identity = await userIdentityRepository.findByProvider('GOOGLE', 'google-789');
    expect(identity?.userId).toBe(existingUser.id);
  });

  it('força PENDING quando o domínio existe mas autoApprove=false', async () => {
    const { service, emailDomainRepository, organizationRepository } = buildContext();
    organizationRepository.items.push({
      id: 'org-1',
      name: 'Cliente X',
      isInternal: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    emailDomainRepository.items.push({
      id: 'domain-1',
      domain: 'clientex.com.br',
      organizationId: 'org-1',
      defaultRole: 'CLIENT',
      autoApprove: false,
      createdAt: new Date(),
    });

    const result = await service.loginOrRegister(
      googleProfile({ email: 'carla@clientex.com.br', providerUserId: 'google-999' }),
      context,
    );

    expect(result).toEqual({ status: 'PENDING' });
  });

  it('reutiliza a UserIdentity já vinculada em logins subsequentes (passo 1)', async () => {
    const { service, emailDomainRepository, organizationRepository, userIdentityRepository } =
      buildContext();
    organizationRepository.items.push({
      id: 'org-1',
      name: 'Opusce',
      isInternal: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    emailDomainRepository.items.push({
      id: 'domain-1',
      domain: 'opusce.com.br',
      organizationId: 'org-1',
      defaultRole: 'OPERATIONAL',
      autoApprove: true,
      createdAt: new Date(),
    });

    const first = await service.loginOrRegister(googleProfile(), context);
    if (first.status !== 'ACTIVE') throw new Error('setup falhou');

    const second = await service.loginOrRegister(googleProfile(), context);

    expect(second.status).toBe('ACTIVE');
    if (second.status === 'ACTIVE') {
      expect(second.user.id).toBe(first.user.id);
    }
    // Não criou uma segunda UserIdentity para o mesmo (provider, providerUserId).
    expect(
      userIdentityRepository.items.filter((i) => i.providerUserId === 'google-123'),
    ).toHaveLength(1);
  });

  it('rejeita e-mail não verificado com EMAIL_NOT_VERIFIED antes de resolver o usuário', async () => {
    const { service } = buildContext();

    await expect(
      service.loginOrRegister(googleProfile({ emailVerified: false }), context),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED', status: 400 });
  });

  it('provedor sem credencial configurada não afeta a resolução de outro provedor (isolamento)', async () => {
    // Este teste documenta que a ausência de credencial é tratada na camada
    // de configuração do Passport (src/passport/index.ts), não no service:
    // o SocialAuthService não sabe nada sobre credenciais de provedor, só
    // resolve o profile recebido — por isso funciona igual para qualquer
    // `provider` presente no enum.
    const { service, emailDomainRepository, organizationRepository } = buildContext();
    organizationRepository.items.push({
      id: 'org-1',
      name: 'Opusce',
      isInternal: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    emailDomainRepository.items.push({
      id: 'domain-1',
      domain: 'opusce.com.br',
      organizationId: 'org-1',
      defaultRole: 'OPERATIONAL',
      autoApprove: true,
      createdAt: new Date(),
    });

    const result = await service.loginOrRegister(
      {
        provider: 'MICROSOFT',
        providerUserId: 'ms-1',
        email: 'ana@opusce.com.br',
        emailVerified: true,
        name: 'Ana',
      },
      context,
    );

    expect(result.status).toBe('ACTIVE');
  });
});
