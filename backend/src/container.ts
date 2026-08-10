import type { PrismaClient } from '@prisma/client';

import { env } from '@/config/env';
import { AuthController } from '@/http/controllers/auth-controller';
import { CompanyController } from '@/http/controllers/company-controller';
import { DocumentController } from '@/http/controllers/document-controller';
import { KanbanStageController } from '@/http/controllers/kanban-stage-controller';
import { OrganizationController } from '@/http/controllers/organization-controller';
import { ProcessController } from '@/http/controllers/process-controller';
import { SocialAuthController } from '@/http/controllers/social-auth-controller';
import { UserManagementController } from '@/http/controllers/user-management-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import type { UploadMiddlewareConfig } from '@/http/middlewares/upload';
import { PrismaCompanyRepository } from '@/infra/prisma/repositories/prisma-company-repository';
import { PrismaDocumentRepository } from '@/infra/prisma/repositories/prisma-document-repository';
import { PrismaEmailDomainRepository } from '@/infra/prisma/repositories/prisma-email-domain-repository';
import { PrismaKanbanStageRepository } from '@/infra/prisma/repositories/prisma-kanban-stage-repository';
import { PrismaOrganizationRepository } from '@/infra/prisma/repositories/prisma-organization-repository';
import { PrismaProcessRepository } from '@/infra/prisma/repositories/prisma-process-repository';
import { PrismaRefreshTokenRepository } from '@/infra/prisma/repositories/prisma-refresh-token-repository';
import { PrismaUserIdentityRepository } from '@/infra/prisma/repositories/prisma-user-identity-repository';
import { PrismaUserRepository } from '@/infra/prisma/repositories/prisma-user-repository';
import { BcryptPasswordHasher } from '@/infra/security/password-hasher';
import { JwtTokenService } from '@/infra/security/token-service';
import { LocalDiskStorage } from '@/infra/storage/local-disk-storage';
import { configurePassport, passport } from '@/passport';
import type { ConfiguredProviders } from '@/passport';
import { AccessScopeResolver } from '@/services/access-scope-resolver';
import { AuthService } from '@/services/auth-service';
import { CompanyService } from '@/services/company-service';
import { DocumentService } from '@/services/document-service';
import { DomainProvisioningService } from '@/services/domain-provisioning-service';
import { KanbanStageService } from '@/services/kanban-stage-service';
import { OrganizationService } from '@/services/organization-service';
import { ProcessService } from '@/services/process-service';
import { SocialAuthService } from '@/services/social-auth-service';
import { TokenIssuer } from '@/services/token-issuer';
import { UserManagementService } from '@/services/user-management-service';

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
  socialAuthController: SocialAuthController;
  configuredProviders: ConfiguredProviders;
  organizationController: OrganizationController;
  companyController: CompanyController;
  userManagementController: UserManagementController;
  kanbanStageController: KanbanStageController;
  processController: ProcessController;
  documentController: DocumentController;
  uploadMiddlewareConfig: UploadMiddlewareConfig;
}

export function buildContainer(prisma: PrismaClient): Container {
  const userRepository = new PrismaUserRepository(prisma);
  const userIdentityRepository = new PrismaUserIdentityRepository(prisma);
  const refreshTokenRepository = new PrismaRefreshTokenRepository(prisma);
  const organizationRepository = new PrismaOrganizationRepository(prisma);
  const companyRepository = new PrismaCompanyRepository(prisma);
  const emailDomainRepository = new PrismaEmailDomainRepository(prisma);
  const kanbanStageRepository = new PrismaKanbanStageRepository(prisma);
  const processRepository = new PrismaProcessRepository(prisma);
  const documentRepository = new PrismaDocumentRepository(prisma);

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

  const tokenIssuer = new TokenIssuer({
    tokenService,
    refreshTokenRepository,
    accessTokenTtl: env.JWT_ACCESS_TTL,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  });

  const socialAuthService = new SocialAuthService({
    userRepository,
    userIdentityRepository,
    organizationRepository,
    domainProvisioningService,
    tokenIssuer,
  });

  // Registra as estratégias apenas quando há credencial configurada
  // (docs/06, critério de aceite da Tarefa 5) — nunca impede a subida da API.
  const configuredProviders = configurePassport(socialAuthService);

  const authenticateDeps: AuthenticateDeps = { tokenService, userRepository, accessScopeResolver };

  const organizationService = new OrganizationService({
    organizationRepository,
    emailDomainRepository,
    companyRepository,
  });

  const companyService = new CompanyService({ companyRepository, organizationRepository });

  const userManagementService = new UserManagementService({
    userRepository,
    userIdentityRepository,
    organizationRepository,
    companyRepository,
    refreshTokenRepository,
  });

  const kanbanStageService = new KanbanStageService({ stageRepository: kanbanStageRepository });

  const processService = new ProcessService({
    processRepository,
    companyRepository,
    stageRepository: kanbanStageRepository,
    userRepository,
  });

  const storageProvider = new LocalDiskStorage(env.STORAGE_ROOT);
  const documentService = new DocumentService({
    documentRepository,
    processRepository,
    storageProvider,
    maxFilesPerRequest: env.MAX_FILES_PER_REQUEST,
  });

  return {
    prisma,
    authController: new AuthController(authService, organizationRepository),
    authenticateDeps,
    socialAuthController: new SocialAuthController(passport, configuredProviders),
    configuredProviders,
    organizationController: new OrganizationController(organizationService),
    companyController: new CompanyController(companyService),
    userManagementController: new UserManagementController(userManagementService),
    kanbanStageController: new KanbanStageController(kanbanStageService),
    processController: new ProcessController(processService),
    documentController: new DocumentController(documentService),
    uploadMiddlewareConfig: {
      maxFileSizeMb: env.MAX_UPLOAD_SIZE_MB,
      maxFilesPerRequest: env.MAX_FILES_PER_REQUEST,
    },
  };
}
