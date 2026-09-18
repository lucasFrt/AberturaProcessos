import { InMemoryCompanyRepository } from '../helpers/fakes/in-memory-company-repository';
import { InMemoryOrganizationRepository } from '../helpers/fakes/in-memory-organization-repository';
import { InMemoryRefreshTokenRepository } from '../helpers/fakes/in-memory-refresh-token-repository';
import { InMemoryUserIdentityRepository } from '../helpers/fakes/in-memory-user-identity-repository';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import { ConflictError, NotFoundError, ValidationError } from '@/domain/errors/app-error';
import { UserManagementService } from '@/services/user-management-service';

function buildContext(): {
  service: UserManagementService;
  userRepository: InMemoryUserRepository;
  organizationRepository: InMemoryOrganizationRepository;
  companyRepository: InMemoryCompanyRepository;
  refreshTokenRepository: InMemoryRefreshTokenRepository;
  organizationId: string;
} {
  const userRepository = new InMemoryUserRepository();
  const userIdentityRepository = new InMemoryUserIdentityRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const companyRepository = new InMemoryCompanyRepository();
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();

  const service = new UserManagementService({
    userRepository,
    userIdentityRepository,
    organizationRepository,
    companyRepository,
    refreshTokenRepository,
  });

  const organizationId = 'org-1';
  organizationRepository.items.push({
    id: organizationId,
    name: 'Cliente X',
    isInternal: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return {
    service,
    userRepository,
    organizationRepository,
    companyRepository,
    refreshTokenRepository,
    organizationId,
  };
}

describe('UserManagementService', () => {
  describe('approve', () => {
    it('aprova usuário pendente e grava approvedAt/approvedById', async () => {
      const { service, userRepository, organizationId } = buildContext();
      const admin = await userRepository.create({
        name: 'Admin',
        email: 'admin-approve@teste.com',
        passwordHash: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });
      const adminId = admin.id;
      const pending = await userRepository.create({
        name: 'Pendente',
        email: 'pendente@teste.com',
        passwordHash: null,
        role: 'CLIENT',
        status: 'PENDING',
        accessScope: 'ORGANIZATION',
        organizationId: null,
      });

      const approved = await service.approve(pending.id, adminId, {
        role: 'CLIENT',
        organizationId,
        accessScope: 'ORGANIZATION',
      });

      expect(approved.status).toBe('ACTIVE');
      expect(approved.approvedById).toBe(adminId);
      expect(approved.approvedAt).not.toBeNull();
    });

    it('rejeita aprovar usuário que não está PENDING com 409', async () => {
      const { service, userRepository, organizationId } = buildContext();
      const active = await userRepository.create({
        name: 'Ativo',
        email: 'ativo@teste.com',
        passwordHash: null,
        role: 'CLIENT',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });

      await expect(
        service.approve(active.id, 'admin-1', {
          role: 'CLIENT',
          organizationId,
          accessScope: 'ORGANIZATION',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('vincula CNPJs quando accessScope = COMPANIES', async () => {
      const { service, userRepository, companyRepository, organizationId } = buildContext();
      const company = await companyRepository.create({
        cnpj: '11222333000181',
        documentType: 'CNPJ',
        legalName: 'Empresa',
        tradeName: null,
        organizationId,
      });
      const pending = await userRepository.create({
        name: 'Pendente',
        email: 'pendente2@teste.com',
        passwordHash: null,
        role: 'CLIENT',
        status: 'PENDING',
        accessScope: 'ORGANIZATION',
        organizationId: null,
      });

      await service.approve(pending.id, 'admin-1', {
        role: 'CLIENT',
        organizationId,
        accessScope: 'COMPANIES',
        companyIds: [company.id],
      });

      const companyIds = await userRepository.listCompanyIdsByUser(pending.id);
      expect(companyIds).toEqual([company.id]);
    });

    it('rejeita CNPJ inexistente com ValidationError', async () => {
      const { service, userRepository, organizationId } = buildContext();
      const pending = await userRepository.create({
        name: 'Pendente',
        email: 'pendente3@teste.com',
        passwordHash: null,
        role: 'CLIENT',
        status: 'PENDING',
        accessScope: 'ORGANIZATION',
        organizationId: null,
      });

      await expect(
        service.approve(pending.id, 'admin-1', {
          role: 'CLIENT',
          organizationId,
          accessScope: 'COMPANIES',
          companyIds: ['nao-existe'],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('reject', () => {
    it('rejeita usuário pendente', async () => {
      const { service, userRepository } = buildContext();
      const pending = await userRepository.create({
        name: 'Pendente',
        email: 'pendente4@teste.com',
        passwordHash: null,
        role: 'CLIENT',
        status: 'PENDING',
        accessScope: 'ORGANIZATION',
        organizationId: null,
      });

      const rejected = await service.reject(pending.id, { reason: 'não reconhecido' });
      expect(rejected.status).toBe('REJECTED');
    });
  });

  describe('update — guards de autoproteção do ADMIN', () => {
    it('impede que o próprio ADMIN se rebaixe', async () => {
      const { service, userRepository, organizationId } = buildContext();
      const admin = await userRepository.create({
        name: 'Admin',
        email: 'admin@teste.com',
        passwordHash: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });
      // Segundo ADMIN para não conflitar com o guard de "ao menos um admin".
      await userRepository.create({
        name: 'Admin 2',
        email: 'admin2@teste.com',
        passwordHash: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });

      await expect(service.update(admin.id, admin.id, { role: 'CLIENT' })).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('impede que o próprio ADMIN se desative', async () => {
      const { service, userRepository, organizationId } = buildContext();
      const admin = await userRepository.create({
        name: 'Admin',
        email: 'admin3@teste.com',
        passwordHash: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });
      await userRepository.create({
        name: 'Admin 2',
        email: 'admin4@teste.com',
        passwordHash: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });

      await expect(
        service.update(admin.id, admin.id, { status: 'DISABLED' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('impede desativar o único ADMIN ativo restante, mesmo por outro ator', async () => {
      const { service, userRepository, organizationId } = buildContext();
      const onlyAdmin = await userRepository.create({
        name: 'Único Admin',
        email: 'unico@teste.com',
        passwordHash: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });
      const otherAdmin = await userRepository.create({
        name: 'Outro Admin',
        email: 'outro@teste.com',
        passwordHash: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });
      // Remove o "outro" admin da contagem de restantes, simulando que só existe um ativo.
      await userRepository.update(otherAdmin.id, { status: 'DISABLED' });

      await expect(
        service.update(onlyAdmin.id, otherAdmin.id, { status: 'DISABLED' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('permite atualizar outro usuário normalmente e revoga tokens ao desativar', async () => {
      const { service, userRepository, refreshTokenRepository, organizationId } = buildContext();
      const admin = await userRepository.create({
        name: 'Admin',
        email: 'admin5@teste.com',
        passwordHash: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });
      const target = await userRepository.create({
        name: 'Cliente',
        email: 'cliente@teste.com',
        passwordHash: null,
        role: 'CLIENT',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });
      await refreshTokenRepository.create({
        userId: target.id,
        tokenHash: 'hash-1',
        expiresAt: new Date(Date.now() + 100000),
        userAgent: null,
        ipAddress: null,
      });

      const updated = await service.update(target.id, admin.id, { status: 'DISABLED' });
      expect(updated.status).toBe('DISABLED');
      expect(refreshTokenRepository.items[0]?.revokedAt).not.toBeNull();
    });
  });

  describe('listOperational', () => {
    it('lista usuários ativos OPERATIONAL/ADMIN', async () => {
      const { service, userRepository, organizationId } = buildContext();
      await userRepository.create({
        name: 'Operacional',
        email: 'op@teste.com',
        passwordHash: null,
        role: 'OPERATIONAL',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });
      await userRepository.create({
        name: 'Cliente',
        email: 'cliente2@teste.com',
        passwordHash: null,
        role: 'CLIENT',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });

      const operational = await service.listOperational();
      expect(operational).toHaveLength(1);
      expect(operational[0]?.role).toBe('OPERATIONAL');
    });
  });

  describe('replaceCompanies', () => {
    it('substitui o conjunto de CNPJs quando accessScope = COMPANIES', async () => {
      const { service, userRepository, companyRepository, organizationId } = buildContext();
      const company = await companyRepository.create({
        cnpj: '11222333000181',
        documentType: 'CNPJ',
        legalName: 'Empresa',
        tradeName: null,
        organizationId,
      });
      const user = await userRepository.create({
        name: 'Cliente',
        email: 'cliente3@teste.com',
        passwordHash: null,
        role: 'CLIENT',
        status: 'ACTIVE',
        accessScope: 'COMPANIES',
        organizationId,
      });

      await service.replaceCompanies(user.id, [company.id]);
      const companyIds = await userRepository.listCompanyIdsByUser(user.id);
      expect(companyIds).toEqual([company.id]);
    });

    it('rejeita quando accessScope != COMPANIES', async () => {
      const { service, userRepository, organizationId } = buildContext();
      const user = await userRepository.create({
        name: 'Cliente',
        email: 'cliente4@teste.com',
        passwordHash: null,
        role: 'CLIENT',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId,
      });

      await expect(service.replaceCompanies(user.id, [])).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
    });
  });

  describe('findById', () => {
    it('lança NotFoundError para usuário inexistente', async () => {
      const { service } = buildContext();
      await expect(service.findById('nao-existe')).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
