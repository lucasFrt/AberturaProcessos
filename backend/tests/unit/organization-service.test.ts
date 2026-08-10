import { InMemoryCompanyRepository } from '../helpers/fakes/in-memory-company-repository';
import { InMemoryEmailDomainRepository } from '../helpers/fakes/in-memory-email-domain-repository';
import { InMemoryOrganizationRepository } from '../helpers/fakes/in-memory-organization-repository';

import { ConflictError, NotFoundError } from '@/domain/errors/app-error';
import { OrganizationService } from '@/services/organization-service';

/**
 * RF-10, RF-13, RF-14 (docs/02) e critério de aceite da Tarefa 7 (docs/12):
 * CRUD de Organization + gestão de EmailDomain com unicidade de domínio.
 */
function buildContext(): {
  service: OrganizationService;
  organizationRepository: InMemoryOrganizationRepository;
  emailDomainRepository: InMemoryEmailDomainRepository;
  companyRepository: InMemoryCompanyRepository;
} {
  const organizationRepository = new InMemoryOrganizationRepository();
  const emailDomainRepository = new InMemoryEmailDomainRepository();
  const companyRepository = new InMemoryCompanyRepository();

  return {
    service: new OrganizationService({
      organizationRepository,
      emailDomainRepository,
      companyRepository,
    }),
    organizationRepository,
    emailDomainRepository,
    companyRepository,
  };
}

describe('OrganizationService', () => {
  describe('create/list/update', () => {
    it('cria organização e a lista de volta', async () => {
      const { service } = buildContext();
      const created = await service.create({ name: 'Cliente X', isInternal: false });

      const page = await service.list({}, { page: 1, pageSize: 20 });
      expect(page.total).toBe(1);
      expect(page.items[0]?.id).toBe(created.id);
    });

    it('atualiza nome e isActive', async () => {
      const { service } = buildContext();
      const created = await service.create({ name: 'Cliente X', isInternal: false });

      const updated = await service.update(created.id, { name: 'Cliente X Ltda', isActive: false });
      expect(updated.name).toBe('Cliente X Ltda');
      expect(updated.isActive).toBe(false);
    });

    it('lança NotFoundError ao atualizar organização inexistente', async () => {
      const { service } = buildContext();
      await expect(service.update('nao-existe', { name: 'X' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('delete', () => {
    it('exclui organização sem vínculos', async () => {
      const { service, organizationRepository } = buildContext();
      const created = await service.create({ name: 'Cliente X', isInternal: false });

      await service.delete(created.id);
      expect(organizationRepository.items).toHaveLength(0);
    });

    it('bloqueia exclusão com usuários/CNPJs/processos vinculados com 409', async () => {
      const { service, organizationRepository } = buildContext();
      const created = await service.create({ name: 'Cliente X', isInternal: false });
      organizationRepository.dependents.set(created.id, {
        users: 1,
        companies: 0,
        processes: 0,
      });

      await expect(service.delete(created.id)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('domínios de e-mail', () => {
    it('cria domínio vinculado à organização', async () => {
      const { service } = buildContext();
      const org = await service.create({ name: 'Cliente X', isInternal: false });

      const domain = await service.createDomain(org.id, {
        domain: 'ClienteX.com.br',
        defaultRole: 'CLIENT',
        autoApprove: true,
      });

      expect(domain.domain).toBe('clientex.com.br');
      expect(domain.organizationId).toBe(org.id);
    });

    it('rejeita domínio já usado por outra organização com 409', async () => {
      const { service } = buildContext();
      const orgA = await service.create({ name: 'Org A', isInternal: false });
      const orgB = await service.create({ name: 'Org B', isInternal: false });

      await service.createDomain(orgA.id, {
        domain: 'compartilhado.com.br',
        defaultRole: 'CLIENT',
        autoApprove: true,
      });

      await expect(
        service.createDomain(orgB.id, {
          domain: 'compartilhado.com.br',
          defaultRole: 'CLIENT',
          autoApprove: true,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('remove domínio da organização', async () => {
      const { service, emailDomainRepository } = buildContext();
      const org = await service.create({ name: 'Cliente X', isInternal: false });
      const domain = await service.createDomain(org.id, {
        domain: 'clientex.com.br',
        defaultRole: 'CLIENT',
        autoApprove: true,
      });

      await service.deleteDomain(org.id, domain.id);
      expect(emailDomainRepository.items).toHaveLength(0);
    });

    it('lança NotFoundError ao remover domínio de outra organização', async () => {
      const { service } = buildContext();
      const orgA = await service.create({ name: 'Org A', isInternal: false });
      const orgB = await service.create({ name: 'Org B', isInternal: false });
      const domain = await service.createDomain(orgA.id, {
        domain: 'orga.com.br',
        defaultRole: 'CLIENT',
        autoApprove: true,
      });

      await expect(service.deleteDomain(orgB.id, domain.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
