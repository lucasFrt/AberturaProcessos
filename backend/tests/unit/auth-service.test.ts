import { FakePasswordHasher } from '../helpers/fakes/fake-password-hasher';
import { FakeQueueProvider } from '../helpers/fakes/fake-queue-provider';
import { FakeTokenService } from '../helpers/fakes/fake-token-service';
import { InMemoryCompanyRepository } from '../helpers/fakes/in-memory-company-repository';
import { InMemoryEmailDomainRepository } from '../helpers/fakes/in-memory-email-domain-repository';
import { InMemoryOrganizationRepository } from '../helpers/fakes/in-memory-organization-repository';
import { InMemoryRefreshTokenRepository } from '../helpers/fakes/in-memory-refresh-token-repository';
import { InMemoryUserIdentityRepository } from '../helpers/fakes/in-memory-user-identity-repository';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import { UnauthenticatedError } from '@/domain/errors/app-error';
import { EMAIL_JOBS } from '@/domain/queue/queue-provider';
import { AccessScopeResolver } from '@/services/access-scope-resolver';
import { AuthService, type AuthServiceDeps } from '@/services/auth-service';
import { DomainProvisioningService } from '@/services/domain-provisioning-service';

function buildContext(): {
  service: AuthService;
  userRepository: InMemoryUserRepository;
  refreshTokenRepository: InMemoryRefreshTokenRepository;
  emailDomainRepository: InMemoryEmailDomainRepository;
  organizationRepository: InMemoryOrganizationRepository;
  queueProvider: FakeQueueProvider;
} {
  const userRepository = new InMemoryUserRepository();
  const userIdentityRepository = new InMemoryUserIdentityRepository();
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const companyRepository = new InMemoryCompanyRepository();
  const emailDomainRepository = new InMemoryEmailDomainRepository();
  const queueProvider = new FakeQueueProvider();

  const deps: AuthServiceDeps = {
    userRepository,
    userIdentityRepository,
    refreshTokenRepository,
    organizationRepository,
    companyRepository,
    passwordHasher: new FakePasswordHasher(),
    tokenService: new FakeTokenService(),
    domainProvisioningService: new DomainProvisioningService(emailDomainRepository),
    accessScopeResolver: new AccessScopeResolver(userRepository),
    accessTokenTtl: '15m',
    refreshTokenTtlDays: 7,
    queueProvider,
  };

  return {
    service: new AuthService(deps),
    userRepository,
    refreshTokenRepository,
    emailDomainRepository,
    organizationRepository,
    queueProvider,
  };
}

const requestContext = { userAgent: 'jest', ipAddress: '127.0.0.1' };

describe('AuthService', () => {
  describe('register', () => {
    it('cria conta ACTIVE com token quando o domínio é conhecido e autoApprove=true', async () => {
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

      const result = await service.register({
        name: 'Ana',
        email: 'ana@opusce.com.br',
        password: 'SenhaForte1',
        ...requestContext,
      });

      expect(result.status).toBe('ACTIVE');
      if (result.status === 'ACTIVE') {
        expect(result.user.role).toBe('OPERATIONAL');
        expect(result.user.organizationId).toBe('org-1');
        expect(result.tokens.accessToken).toBeTruthy();
        expect(result.tokens.refreshToken).toBeTruthy();
      }

      const stored = await userRepository.findByEmail('ana@opusce.com.br');
      expect(stored?.status).toBe('ACTIVE');
    });

    it('cria conta PENDING sem token quando o domínio é desconhecido', async () => {
      const { service } = buildContext();

      const result = await service.register({
        name: 'Bruno',
        email: 'bruno@gmail.com',
        password: 'SenhaForte1',
        ...requestContext,
      });

      expect(result).toEqual({ status: 'PENDING' });
    });

    it('enfileira USER_PENDING_APPROVAL quando o domínio é desconhecido (RF-52/docs/07)', async () => {
      const { service, queueProvider } = buildContext();

      await service.register({
        name: 'Bruno',
        email: 'bruno@gmail.com',
        password: 'SenhaForte1',
        ...requestContext,
      });

      expect(queueProvider.enqueuedJobs).toHaveLength(1);
      const job = queueProvider.enqueuedJobs[0];
      expect(job?.name).toBe(EMAIL_JOBS.USER_PENDING_APPROVAL);
      if (job?.name === EMAIL_JOBS.USER_PENDING_APPROVAL) {
        expect(job.payload.userEmail).toBe('bruno@gmail.com');
        expect(job.payload.provider).toBe('LOCAL');
      }
    });

    it('cria conta PENDING quando o domínio existe mas autoApprove=false', async () => {
      const { service, emailDomainRepository } = buildContext();
      emailDomainRepository.items.push({
        id: 'domain-1',
        domain: 'clientex.com.br',
        organizationId: 'org-1',
        defaultRole: 'CLIENT',
        autoApprove: false,
        createdAt: new Date(),
      });

      const result = await service.register({
        name: 'Carla',
        email: 'carla@clientex.com.br',
        password: 'SenhaForte1',
        ...requestContext,
      });

      expect(result).toEqual({ status: 'PENDING' });
    });

    it('rejeita e-mail já cadastrado com 409', async () => {
      const { service } = buildContext();
      await service.register({
        name: 'Ana',
        email: 'dup@gmail.com',
        password: 'SenhaForte1',
        ...requestContext,
      });

      await expect(
        service.register({
          name: 'Outra',
          email: 'dup@gmail.com',
          password: 'SenhaForte1',
          ...requestContext,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    });
  });

  describe('login', () => {
    async function registerActiveUser(
      service: AuthService,
      emailDomainRepository: InMemoryEmailDomainRepository,
    ): ReturnType<AuthService['register']> {
      emailDomainRepository.items.push({
        id: 'domain-1',
        domain: 'opusce.com.br',
        organizationId: 'org-1',
        defaultRole: 'OPERATIONAL',
        autoApprove: true,
        createdAt: new Date(),
      });
      return service.register({
        name: 'Ana',
        email: 'ana@opusce.com.br',
        password: 'SenhaForte1',
        ...requestContext,
      });
    }

    it('autentica com credenciais válidas e emite tokens', async () => {
      const { service, emailDomainRepository } = buildContext();
      await registerActiveUser(service, emailDomainRepository);

      const result = await service.login({
        email: 'ana@opusce.com.br',
        password: 'SenhaForte1',
        ...requestContext,
      });

      expect(result.user.email).toBe('ana@opusce.com.br');
      expect(result.tokens.accessToken).toBeTruthy();
    });

    it('rejeita senha incorreta com 401 INVALID_CREDENTIALS', async () => {
      const { service, emailDomainRepository } = buildContext();
      await registerActiveUser(service, emailDomainRepository);

      await expect(
        service.login({ email: 'ana@opusce.com.br', password: 'SenhaErrada1', ...requestContext }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    });

    it('rejeita e-mail inexistente com o mesmo erro (sem revelar existência da conta)', async () => {
      const { service } = buildContext();

      await expect(
        service.login({ email: 'ninguem@gmail.com', password: 'SenhaForte1', ...requestContext }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    });

    it('rejeita conta pendente com 403 ACCOUNT_PENDING', async () => {
      const { service } = buildContext();
      await service.register({
        name: 'Bruno',
        email: 'bruno@gmail.com',
        password: 'SenhaForte1',
        ...requestContext,
      });

      await expect(
        service.login({ email: 'bruno@gmail.com', password: 'SenhaForte1', ...requestContext }),
      ).rejects.toMatchObject({ code: 'ACCOUNT_PENDING', status: 403 });
    });

    it('rejeita conta desativada com 403 ACCOUNT_DISABLED', async () => {
      const { service, emailDomainRepository, userRepository } = buildContext();
      await registerActiveUser(service, emailDomainRepository);
      const stored = await userRepository.findByEmail('ana@opusce.com.br');
      await userRepository.update(stored!.id, { status: 'DISABLED' });

      await expect(
        service.login({ email: 'ana@opusce.com.br', password: 'SenhaForte1', ...requestContext }),
      ).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED', status: 403 });
    });
  });

  describe('refresh', () => {
    it('rotaciona o token: o antigo passa a falhar e um novo é emitido', async () => {
      const { service, emailDomainRepository } = buildContext();
      emailDomainRepository.items.push({
        id: 'domain-1',
        domain: 'opusce.com.br',
        organizationId: 'org-1',
        defaultRole: 'OPERATIONAL',
        autoApprove: true,
        createdAt: new Date(),
      });
      const registerResult = await service.register({
        name: 'Ana',
        email: 'ana@opusce.com.br',
        password: 'SenhaForte1',
        ...requestContext,
      });
      if (registerResult.status !== 'ACTIVE') throw new Error('setup falhou');

      const firstRefreshToken = registerResult.tokens.refreshToken;
      const { tokens: rotated } = await service.refresh({
        refreshToken: firstRefreshToken,
        ...requestContext,
      });

      expect(rotated.refreshToken).not.toBe(firstRefreshToken);

      // O token antigo foi revogado: reusá-lo deve falhar.
      await expect(
        service.refresh({ refreshToken: firstRefreshToken, ...requestContext }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it('reuso de token revogado revoga toda a família e responde 401', async () => {
      const { service, emailDomainRepository, refreshTokenRepository } = buildContext();
      emailDomainRepository.items.push({
        id: 'domain-1',
        domain: 'opusce.com.br',
        organizationId: 'org-1',
        defaultRole: 'OPERATIONAL',
        autoApprove: true,
        createdAt: new Date(),
      });
      const registerResult = await service.register({
        name: 'Ana',
        email: 'ana@opusce.com.br',
        password: 'SenhaForte1',
        ...requestContext,
      });
      if (registerResult.status !== 'ACTIVE') throw new Error('setup falhou');

      const firstToken = registerResult.tokens.refreshToken;
      const { tokens: rotated } = await service.refresh({
        refreshToken: firstToken,
        ...requestContext,
      });

      // Reusa o token já revogado (simulando vazamento).
      await expect(
        service.refresh({ refreshToken: firstToken, ...requestContext }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);

      // A família inteira (incluindo o token rotacionado, ainda válido) foi revogada.
      await expect(
        service.refresh({ refreshToken: rotated.refreshToken, ...requestContext }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);

      expect(refreshTokenRepository.items.every((token) => token.revokedAt !== null)).toBe(true);
    });

    it('rejeita token inexistente com 401', async () => {
      const { service } = buildContext();

      await expect(
        service.refresh({ refreshToken: 'nao-existe', ...requestContext }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });

  describe('logout', () => {
    it('revoga o refresh token informado', async () => {
      const { service, emailDomainRepository, refreshTokenRepository } = buildContext();
      emailDomainRepository.items.push({
        id: 'domain-1',
        domain: 'opusce.com.br',
        organizationId: 'org-1',
        defaultRole: 'OPERATIONAL',
        autoApprove: true,
        createdAt: new Date(),
      });
      const registerResult = await service.register({
        name: 'Ana',
        email: 'ana@opusce.com.br',
        password: 'SenhaForte1',
        ...requestContext,
      });
      if (registerResult.status !== 'ACTIVE') throw new Error('setup falhou');

      await service.logout(registerResult.tokens.refreshToken);

      const revoked = refreshTokenRepository.items.find(
        (token) => token.userId === registerResult.user.id,
      );
      expect(revoked?.revokedAt).not.toBeNull();
    });
  });

  describe('me', () => {
    it('devolve usuário, organização, CNPJs e permissões efetivas', async () => {
      const { service, emailDomainRepository, organizationRepository, userRepository } =
        buildContext();
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
      userRepository.organizationCompanies.set('org-1', ['company-1']);

      const registerResult = await service.register({
        name: 'Diana',
        email: 'diana@clientex.com.br',
        password: 'SenhaForte1',
        ...requestContext,
      });
      if (registerResult.status !== 'ACTIVE') throw new Error('setup falhou');

      const result = await service.me(registerResult.user.id);

      expect(result.organization?.name).toBe('Cliente X');
      expect(result.scope).toEqual({ kind: 'COMPANIES', companyIds: ['company-1'] });
      expect(result.permissions).toContain('process:create');
    });

    it('lança UnauthenticatedError para usuário inexistente', async () => {
      const { service } = buildContext();

      await expect(service.me('nao-existe')).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });
});
