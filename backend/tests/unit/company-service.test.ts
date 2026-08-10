import { InMemoryCompanyRepository } from '../helpers/fakes/in-memory-company-repository';
import { InMemoryOrganizationRepository } from '../helpers/fakes/in-memory-organization-repository';

import { ConflictError, NotFoundError } from '@/domain/errors/app-error';
import { CompanyService } from '@/services/company-service';

const VALID_CNPJ = '11222333000181';
const VALID_CNPJ_2 = '11444777000161';

function buildContext(): {
  service: CompanyService;
  companyRepository: InMemoryCompanyRepository;
  organizationRepository: InMemoryOrganizationRepository;
  organizationId: string;
} {
  const companyRepository = new InMemoryCompanyRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const service = new CompanyService({ companyRepository, organizationRepository });

  const organizationId = 'org-1';
  organizationRepository.items.push({
    id: organizationId,
    name: 'Cliente X',
    isInternal: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { service, companyRepository, organizationRepository, organizationId };
}

describe('CompanyService', () => {
  describe('create', () => {
    it('cria empresa com CNPJ válido (com máscara) persistindo só dígitos', async () => {
      const { service, organizationId } = buildContext();

      const company = await service.create({
        cnpj: '11.222.333/0001-81',
        legalName: 'Cliente X Matriz LTDA',
        organizationId,
      });

      expect(company.cnpj).toBe(VALID_CNPJ);
    });

    it('rejeita CNPJ com dígitos verificadores inválidos com 400 INVALID_CNPJ', async () => {
      const { service, organizationId } = buildContext();

      await expect(
        service.create({ cnpj: '11222333000180', legalName: 'Empresa', organizationId }),
      ).rejects.toMatchObject({ code: 'INVALID_CNPJ', status: 400 });
    });

    it('rejeita organização inexistente com 404', async () => {
      const { service } = buildContext();

      await expect(
        service.create({ cnpj: VALID_CNPJ, legalName: 'Empresa', organizationId: 'nao-existe' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejeita CNPJ duplicado com 409', async () => {
      const { service, organizationId } = buildContext();
      await service.create({ cnpj: VALID_CNPJ, legalName: 'Empresa A', organizationId });

      await expect(
        service.create({ cnpj: VALID_CNPJ, legalName: 'Empresa B', organizationId }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('aceita dois CNPJs distintos para a mesma organização', async () => {
      const { service, organizationId } = buildContext();
      const first = await service.create({ cnpj: VALID_CNPJ, legalName: 'Matriz', organizationId });
      const second = await service.create({
        cnpj: VALID_CNPJ_2,
        legalName: 'Filial',
        organizationId,
      });

      expect(first.id).not.toBe(second.id);
    });
  });

  describe('update', () => {
    it('atualiza dados da empresa', async () => {
      const { service, organizationId } = buildContext();
      const company = await service.create({
        cnpj: VALID_CNPJ,
        legalName: 'Antigo',
        organizationId,
      });

      const updated = await service.update(company.id, { legalName: 'Novo Nome', isActive: false });
      expect(updated.legalName).toBe('Novo Nome');
      expect(updated.isActive).toBe(false);
    });

    it('rejeita organizationId inexistente na atualização', async () => {
      const { service, organizationId } = buildContext();
      const company = await service.create({
        cnpj: VALID_CNPJ,
        legalName: 'Empresa',
        organizationId,
      });

      await expect(
        service.update(company.id, { organizationId: 'nao-existe' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('delete', () => {
    it('exclui empresa sem processos vinculados', async () => {
      const { service, companyRepository, organizationId } = buildContext();
      const company = await service.create({
        cnpj: VALID_CNPJ,
        legalName: 'Empresa',
        organizationId,
      });

      await service.delete(company.id);
      expect(companyRepository.items).toHaveLength(0);
    });

    it('bloqueia exclusão com processos vinculados com 409 e processCount', async () => {
      const { service, companyRepository, organizationId } = buildContext();
      const company = await service.create({
        cnpj: VALID_CNPJ,
        legalName: 'Empresa',
        organizationId,
      });
      companyRepository.linkedProcessCounts.set(company.id, 3);

      await expect(service.delete(company.id)).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
        details: { processCount: 3 },
      });
    });
  });
});
