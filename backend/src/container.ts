import type { PrismaClient } from '@prisma/client';

import { env } from '@/config/env';
import { AuthController } from '@/http/controllers/auth-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import { PrismaCompanyRepository } from '@/infra/prisma/repositories/prisma-company-repository';
import { PrismaEmailDomainRepository } from '@/infra/prisma/repositories/prisma-email-domain-repository';
import { PrismaOrganizationRepository } from '@/infra/prisma/repositories/prisma-organization-repository';
import { PrismaRefreshTokenRepository } from '@/infra/prisma/repositories/prisma-refresh-token-repository';
import { PrismaUserIdentityRepository } from '@/infra/prisma/repositories/prisma-user-identity-repository';
import { PrismaUserRepository } from '@/infra/prisma/repositories/prisma-user-repository';
import { BcryptPasswordHasher } from '@/infra/security/password-hasher';
import { JwtTokenService } from '@/infra/security/token-service';
import { AccessScopeResolver } from '@/services/access-scope-resolver';
import { AuthService } from '@/services/auth-service';
import { DomainProvisioningService } from '@/services/domain-provisioning-service';

/**
 * Ponto único de composição manual de dependências (docs/03-arquitetura.md,
 * seção "Injeção de dependência"). Sem decorators, sem reflect-metadata:
 * cada repositório/provider é instanciado aqui e injetado por construtor
 * nos services correspondentes.
 */
export interface Container {
  prisma: PrismaClient;
  authController: AuthController;
  authenticateDeps: AuthenticateDeps;
}

export function buildContainer(prisma: PrismaClient): Container {
  const userRepository = new PrismaUserRepository(prisma);
  const userIdentityRepository = new PrismaUserIdentityRepository(prisma);
  const refreshTokenRepository = new PrismaRefreshTokenRepository(prisma);
  const organizationRepository = new PrismaOrganizationRepository(prisma);
  const companyRepository = new PrismaCompanyRepository(prisma);
  const emailDomainRepository = new PrismaEmailDomainRepository(prisma);

  const passwordHasher = new BcryptPasswordHasher();
  const tokenService = new JwtTokenService();
  const accessScopeResolver = new AccessScopeResolver(userRepository);
  const domainProvisioningService = new DomainProvisioningService(emailDomainRepository);

  const authService = new AuthService({
    userRepository,
    userIdentityRepository,
    refreshTokenRepository,
    organizationRepository,
    companyRepository,
    passwordHasher,
    tokenService,
    domainProvisioningService,
    accessScopeResolver,
    accessTokenTtl: env.JWT_ACCESS_TTL,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  });

  const authenticateDeps: AuthenticateDeps = { tokenService, userRepository, accessScopeResolver };

  return {
    prisma,
    authController: new AuthController(authService, organizationRepository),
    authenticateDeps,
  };
}
