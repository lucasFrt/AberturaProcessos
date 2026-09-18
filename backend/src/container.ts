import type { PrismaClient } from '@prisma/client';

import { env } from '@/config/env';
import { ApiKeyController } from '@/http/controllers/api-key-controller';
import { AuthController } from '@/http/controllers/auth-controller';
import { CompanyController } from '@/http/controllers/company-controller';
import { DashboardController } from '@/http/controllers/dashboard-controller';
import { DocumentController } from '@/http/controllers/document-controller';
import { KanbanStageController } from '@/http/controllers/kanban-stage-controller';
import { OrganizationController } from '@/http/controllers/organization-controller';
import { ProcessController } from '@/http/controllers/process-controller';
import { SocialAuthController } from '@/http/controllers/social-auth-controller';
import { UserManagementController } from '@/http/controllers/user-management-controller';
import type { AuthenticateDeps } from '@/http/middlewares/authenticate';
import type { UploadMiddlewareConfig } from '@/http/middlewares/upload';
import { ReceitaWsCnpjLookupProvider } from '@/infra/cnpj/receitaws-cnpj-lookup-provider';
import { logger } from '@/infra/logger';
import { PrismaApiKeyRepository } from '@/infra/prisma/repositories/prisma-api-key-repository';
import { PrismaCompanyRepository } from '@/infra/prisma/repositories/prisma-company-repository';
import { PrismaDashboardRepository } from '@/infra/prisma/repositories/prisma-dashboard-repository';
import { PrismaDocumentRepository } from '@/infra/prisma/repositories/prisma-document-repository';
import { PrismaEmailDomainRepository } from '@/infra/prisma/repositories/prisma-email-domain-repository';
import { PrismaKanbanStageRepository } from '@/infra/prisma/repositories/prisma-kanban-stage-repository';
import { PrismaOrganizationRepository } from '@/infra/prisma/repositories/prisma-organization-repository';
import { PrismaProcessRepository } from '@/infra/prisma/repositories/prisma-process-repository';
import { PrismaRefreshTokenRepository } from '@/infra/prisma/repositories/prisma-refresh-token-repository';
import { PrismaUserIdentityRepository } from '@/infra/prisma/repositories/prisma-user-identity-repository';
import { PrismaUserRepository } from '@/infra/prisma/repositories/prisma-user-repository';
import { BullMqQueueProvider } from '@/infra/queue/bullmq-queue-provider';
import { redisConnectionOptions } from '@/infra/queue/connection';
import { DeferredRealtimeProvider } from '@/infra/realtime/deferred-realtime-provider';
import { BcryptPasswordHasher } from '@/infra/security/password-hasher';
import { JwtTokenService } from '@/infra/security/token-service';
import { LocalDiskStorage } from '@/infra/storage/local-disk-storage';
import { configurePassport, passport } from '@/passport';
import type { ConfiguredProviders } from '@/passport';
import { AccessScopeResolver } from '@/services/access-scope-resolver';
import { ApiKeyService } from '@/services/api-key-service';
import { AuthService } from '@/services/auth-service';
import { CompanyService } from '@/services/company-service';
import { DashboardService } from '@/services/dashboard-service';
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
  queueProvider: BullMqQueueProvider;
  /**
   * Desvio do padrão de `QueueProvider` (docs/07), documentado em
   * `infra/realtime/deferred-realtime-provider.ts`: `SocketIoProvider`
   * precisa do `http.Server`, que só existe depois de `app.listen()` —
   * ou seja, depois que este container e os services já foram montados.
   * `http/server.ts` chama `realtimeProvider.attach(...)` assim que o
   * servidor sobe. Em testes de integração, nada é anexado — o delegate
   * interno permanece no-op.
   */
  realtimeProvider: DeferredRealtimeProvider;
  authController: AuthController;
  authenticateDeps: AuthenticateDeps;
  apiKeyController: ApiKeyController;
  socialAuthController: SocialAuthController;
  configuredProviders: ConfiguredProviders;
  organizationController: OrganizationController;
  companyController: CompanyController;
  userManagementController: UserManagementController;
  kanbanStageController: KanbanStageController;
  processController: ProcessController;
  documentController: DocumentController;
  uploadMiddlewareConfig: UploadMiddlewareConfig;
  dashboardController: DashboardController;
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
  const dashboardRepository = new PrismaDashboardRepository(prisma);
  const apiKeyRepository = new PrismaApiKeyRepository(prisma);

  const passwordHasher = new BcryptPasswordHasher();
  const tokenService = new JwtTokenService();
  const accessScopeResolver = new AccessScopeResolver(userRepository);
  const domainProvisioningService = new DomainProvisioningService(emailDomainRepository);

  // Composição real do produtor de fila (docs/07): BullMQ sobre a mesma
  // conexão Redis do health check. Em testes unitários, os services
  // recebem um FakeQueueProvider em vez desta instância — nunca sobem
  // Redis de fato (docs/09).
  const queueProvider = new BullMqQueueProvider(redisConnectionOptions, logger);

  // Composição do provedor de tempo real (docs/07, RF-53/RF-54). Ver
  // comentário em `Container.realtimeProvider` e em
  // `infra/realtime/deferred-realtime-provider.ts` sobre o motivo do
  // desvio do padrão de `QueueProvider`.
  const realtimeProvider = new DeferredRealtimeProvider();

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
    queueProvider,
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
    queueProvider,
  });

  // Registra as estratégias apenas quando há credencial configurada
  // (docs/06, critério de aceite da Tarefa 5) — nunca impede a subida da API.
  const configuredProviders = configurePassport(socialAuthService);

  // `apiKeyRepository` entra aqui porque `authenticate` aceita `X-Api-Key`
  // além do JWT (docs/13, decisão 2).
  const authenticateDeps: AuthenticateDeps = {
    tokenService,
    userRepository,
    accessScopeResolver,
    apiKeyRepository,
  };

  const apiKeyService = new ApiKeyService({ apiKeyRepository, userRepository });

  const organizationService = new OrganizationService({
    organizationRepository,
    emailDomainRepository,
    companyRepository,
  });

  // Consulta de CNPJ na Receita (docs/05, "Empresas / CNPJs"). `null` quando
  // desabilitada por configuração: `CompanyService` responde 503
  // CNPJ_LOOKUP_DISABLED e o cadastro manual segue funcionando — é assim que
  // os testes de integração rodam sem depender de API externa (docs/09).
  const cnpjLookupProvider = env.CNPJ_LOOKUP_ENABLED
    ? new ReceitaWsCnpjLookupProvider(
        {
          baseUrl: env.CNPJ_LOOKUP_BASE_URL,
          timeoutMs: env.CNPJ_LOOKUP_TIMEOUT_MS,
          cacheTtlMs: env.CNPJ_LOOKUP_CACHE_TTL_MINUTES * 60_000,
          token: env.CNPJ_LOOKUP_TOKEN,
        },
        logger,
      )
    : null;

  const companyService = new CompanyService({
    companyRepository,
    organizationRepository,
    cnpjLookupProvider,
  });

  const userManagementService = new UserManagementService({
    userRepository,
    userIdentityRepository,
    organizationRepository,
    companyRepository,
    refreshTokenRepository,
  });

  const kanbanStageService = new KanbanStageService({
    stageRepository: kanbanStageRepository,
    realtimeProvider,
  });

  const processService = new ProcessService({
    processRepository,
    companyRepository,
    stageRepository: kanbanStageRepository,
    userRepository,
    queueProvider,
    realtimeProvider,
  });

  const dashboardService = new DashboardService({ dashboardRepository });

  const storageProvider = new LocalDiskStorage(env.STORAGE_ROOT);
  const documentService = new DocumentService({
    documentRepository,
    processRepository,
    storageProvider,
    maxFilesPerRequest: env.MAX_FILES_PER_REQUEST,
    realtimeProvider,
  });

  return {
    prisma,
    queueProvider,
    realtimeProvider,
    authController: new AuthController(authService, organizationRepository),
    authenticateDeps,
    apiKeyController: new ApiKeyController(apiKeyService),
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
    dashboardController: new DashboardController(dashboardService),
  };
}
