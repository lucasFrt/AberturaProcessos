import { FakeCnpjLookupProvider } from '../helpers/fakes/fake-cnpj-lookup-provider';
import { InMemoryCompanyRepository } from '../helpers/fakes/in-memory-company-repository';
import { InMemoryOrganizationRepository } from '../helpers/fakes/in-memory-organization-repository';

import { ConflictError, NotFoundError } from '@/domain/errors/app-error';
import { CompanyService } from '@/services/company-service';

const VALID_CNPJ = '11222333000181';
const VALID_CNPJ_2 = '11444777000161';

function buildContext(options: { cnpjLookupEnabled?: boolean } = {}): {
  service: CompanyService;
  companyRepository: InMemoryCompanyRepository;
  organizationRepository: InMemoryOrganizationRepository;
  cnpjLookupProvider: FakeCnpjLookupProvider;
  organizationId: string;
} {
  const companyRepository = new InMemoryCompanyRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const cnpjLookupProvider = new FakeCnpjLookupProvider();
  const service = new CompanyService({
    companyRepository,
    organizationRepository,
    cnpjLookupProvider: options.cnpjLookupEnabled === false ? null : cnpjLookupProvider,
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
  companyRepository.organizationNames.set(organizationId, 'Cliente X');

  return {
    service,
    companyRepository,
    organizationRepository,
    cnpjLookupProvider,
    organizationId,
  };
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

    it('cria empresa com CPF válido marcando documentType = CPF (docs/13, decisão 5)', async () => {
      const { service, organizationId } = buildContext();

      const company = await service.create({
        cnpj: '529.982.247-25',
        legalName: 'João da Silva',
        organizationId,
      });

      expect(company.cnpj).toBe('52998224725');
      expect(company.documentType).toBe('CPF');
    });

    it('CNPJ válido fica com documentType = CNPJ', async () => {
      const { service, organizationId } = buildContext();

      const company = await service.create({
        cnpj: '11222333000181',
        legalName: 'Empresa',
        organizationId,
      });

      expect(company.documentType).toBe('CNPJ');
    });

    it('rejeita CPF com dígitos verificadores inválidos com 400 INVALID_CPF', async () => {
      const { service, organizationId } = buildContext();

      await expect(
        service.create({ cnpj: '52998224726', legalName: 'X', organizationId }),
      ).rejects.toMatchObject({ code: 'INVALID_CPF', status: 400 });
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

  describe('list', () => {
    it('inclui o nome da organização em cada empresa (coluna "Organização" da tela de admin)', async () => {
      const { service, organizationId } = buildContext();
      await service.create({ cnpj: VALID_CNPJ, legalName: 'Empresa', organizationId });

      const page = await service.list({}, { page: 1, pageSize: 20 });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.organization).toEqual({ id: organizationId, name: 'Cliente X' });
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

  describe('lookupCnpj', () => {
    it('devolve os dados da Receita para um CNPJ não cadastrado', async () => {
      const { service, cnpjLookupProvider } = buildContext();
      cnpjLookupProvider.respondFound({
        cnpj: VALID_CNPJ,
        legalName: 'Saint Pauls Importacao LTDA',
        tradeName: 'Saint Pauls',
        registrationStatus: 'ATIVA',
      });

      const result = await service.lookupCnpj('11.222.333/0001-81');

      expect(result).toEqual({
        cnpj: VALID_CNPJ,
        legalName: 'Saint Pauls Importacao LTDA',
        tradeName: 'Saint Pauls',
        registrationStatus: 'ATIVA',
        alreadyRegistered: false,
        companyId: null,
        organizationId: null,
      });
    });

    it('normaliza a máscara antes de consultar o provedor', async () => {
      const { service, cnpjLookupProvider } = buildContext();
      cnpjLookupProvider.respondFound({ cnpj: VALID_CNPJ, legalName: 'Empresa' });

      await service.lookupCnpj('11.222.333/0001-81');

      expect(cnpjLookupProvider.calls).toEqual([VALID_CNPJ]);
    });

    it('rejeita CNPJ inválido com 400 sem consultar o provedor', async () => {
      const { service, cnpjLookupProvider } = buildContext();

      await expect(service.lookupCnpj('11222333000180')).rejects.toMatchObject({
        code: 'INVALID_CNPJ',
        status: 400,
      });
      // Cota do plano gratuito é de 3 consultas/min: não se gasta uma com
      // CNPJ que já sabemos ser inválido.
      expect(cnpjLookupProvider.calls).toEqual([]);
    });

    it('devolve os dados do próprio banco, sem consultar o provedor, quando o CNPJ já existe', async () => {
      const { service, cnpjLookupProvider, organizationId } = buildContext();
      const existing = await service.create({
        cnpj: VALID_CNPJ,
        legalName: 'Já Cadastrada LTDA',
        tradeName: 'Já Cadastrada',
        organizationId,
      });

      const result = await service.lookupCnpj(VALID_CNPJ);

      expect(result).toMatchObject({
        alreadyRegistered: true,
        companyId: existing.id,
        organizationId,
        legalName: 'Já Cadastrada LTDA',
        tradeName: 'Já Cadastrada',
      });
      expect(cnpjLookupProvider.calls).toEqual([]);
    });

    it('traduz NOT_FOUND do provedor em 404 CNPJ_NOT_FOUND', async () => {
      const { service, cnpjLookupProvider } = buildContext();
      cnpjLookupProvider.outcome = { kind: 'NOT_FOUND' };

      await expect(service.lookupCnpj(VALID_CNPJ_2)).rejects.toMatchObject({
        code: 'CNPJ_NOT_FOUND',
        status: 404,
      });
    });

    it('traduz RATE_LIMITED do provedor em 429 CNPJ_LOOKUP_RATE_LIMITED', async () => {
      const { service, cnpjLookupProvider } = buildContext();
      cnpjLookupProvider.outcome = { kind: 'RATE_LIMITED' };

      await expect(service.lookupCnpj(VALID_CNPJ_2)).rejects.toMatchObject({
        code: 'CNPJ_LOOKUP_RATE_LIMITED',
        status: 429,
      });
    });

    it('traduz UNAVAILABLE do provedor em 503 CNPJ_LOOKUP_UNAVAILABLE', async () => {
      const { service, cnpjLookupProvider } = buildContext();
      cnpjLookupProvider.outcome = { kind: 'UNAVAILABLE', reason: 'Timeout.' };

      await expect(service.lookupCnpj(VALID_CNPJ_2)).rejects.toMatchObject({
        code: 'CNPJ_LOOKUP_UNAVAILABLE',
        status: 503,
      });
    });

    it('responde 503 CNPJ_LOOKUP_DISABLED quando a consulta está desabilitada', async () => {
      const { service } = buildContext({ cnpjLookupEnabled: false });

      await expect(service.lookupCnpj(VALID_CNPJ_2)).rejects.toMatchObject({
        code: 'CNPJ_LOOKUP_DISABLED',
        status: 503,
      });
    });
  });
});
