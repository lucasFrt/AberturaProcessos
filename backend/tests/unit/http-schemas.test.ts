import { createCompanySchema, updateCompanySchema } from '@/http/schemas/company-schemas';
import {
  createKanbanStageSchema,
  updateKanbanStageSchema,
} from '@/http/schemas/kanban-stage-schemas';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  createEmailDomainSchema,
} from '@/http/schemas/organization-schemas';
import { createProcessSchema, updateProcessSchema } from '@/http/schemas/process-schemas';
import { approveUserSchema, updateUserSchema } from '@/http/schemas/user-management-schemas';

/**
 * Cobre os ramos dos schemas Zod que o fluxo feliz de integração não
 * exercita (docs/09, cobertura de `src/http/schemas`): `.refine()`
 * verdadeiro/falso, defaults aplicados e valores opcionais presentes vs.
 * ausentes.
 */
describe('schemas Zod — ramos de refine e defaults', () => {
  describe('company-schemas', () => {
    it('createCompanySchema aceita tradeName ausente (branch optional)', () => {
      const result = createCompanySchema.safeParse({
        cnpj: '11222333000181',
        legalName: 'Empresa Teste',
        organizationId: 'org-1',
      });
      expect(result.success).toBe(true);
    });

    it('updateCompanySchema falha quando nenhum campo é informado (refine falso)', () => {
      const result = updateCompanySchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('updateCompanySchema passa quando ao menos um campo é informado (refine verdadeiro)', () => {
      const result = updateCompanySchema.safeParse({ isActive: false });
      expect(result.success).toBe(true);
    });
  });

  describe('organization-schemas', () => {
    it('createOrganizationSchema aplica default isInternal=false', () => {
      const result = createOrganizationSchema.safeParse({ name: 'Org Teste' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.isInternal).toBe(false);
    });

    it('updateOrganizationSchema falha sem nenhum campo (refine falso)', () => {
      const result = updateOrganizationSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('updateOrganizationSchema passa com ao menos um campo (refine verdadeiro)', () => {
      const result = updateOrganizationSchema.safeParse({ name: 'Novo Nome' });
      expect(result.success).toBe(true);
    });

    it('createEmailDomainSchema aplica defaults defaultRole=CLIENT e autoApprove=true', () => {
      const result = createEmailDomainSchema.safeParse({ domain: 'exemplo.com.br' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultRole).toBe('CLIENT');
        expect(result.data.autoApprove).toBe(true);
      }
    });
  });

  describe('kanban-stage-schemas', () => {
    it('createKanbanStageSchema aceita cor hex de 6 dígitos', () => {
      const result = createKanbanStageSchema.safeParse({ name: 'Nova Etapa', color: '#1677ff' });
      expect(result.success).toBe(true);
    });

    it('createKanbanStageSchema rejeita cor inválida', () => {
      const result = createKanbanStageSchema.safeParse({ name: 'Nova Etapa', color: 'azul' });
      expect(result.success).toBe(false);
    });

    it('updateKanbanStageSchema falha sem nenhum campo (refine falso)', () => {
      const result = updateKanbanStageSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('updateKanbanStageSchema passa com isFinal informado (refine verdadeiro)', () => {
      const result = updateKanbanStageSchema.safeParse({ isFinal: true });
      expect(result.success).toBe(true);
    });
  });

  describe('process-schemas', () => {
    it('createProcessSchema aceita requestingCompanyId null', () => {
      const result = createProcessSchema.safeParse({
        clientCompanyId: 'company-1',
        requestingCompanyId: null,
        reference: 'Referência válida',
      });
      expect(result.success).toBe(true);
    });

    it('updateProcessSchema falha sem nenhum campo (refine falso)', () => {
      const result = updateProcessSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('updateProcessSchema passa com reference informado (refine verdadeiro)', () => {
      const result = updateProcessSchema.safeParse({ reference: 'Nova referência' });
      expect(result.success).toBe(true);
    });
  });

  describe('user-management-schemas', () => {
    it('approveUserSchema falha quando accessScope=COMPANIES sem companyIds (refine falso)', () => {
      const result = approveUserSchema.safeParse({
        role: 'CLIENT',
        organizationId: 'org-1',
        accessScope: 'COMPANIES',
      });
      expect(result.success).toBe(false);
    });

    it('approveUserSchema passa com accessScope=COMPANIES e companyIds (refine verdadeiro)', () => {
      const result = approveUserSchema.safeParse({
        role: 'CLIENT',
        organizationId: 'org-1',
        accessScope: 'COMPANIES',
        companyIds: ['company-1'],
      });
      expect(result.success).toBe(true);
    });

    it('approveUserSchema passa com accessScope=ORGANIZATION sem companyIds (refine verdadeiro, outro ramo)', () => {
      const result = approveUserSchema.safeParse({
        role: 'CLIENT',
        organizationId: 'org-1',
        accessScope: 'ORGANIZATION',
      });
      expect(result.success).toBe(true);
    });

    it('updateUserSchema falha sem nenhum campo (refine falso)', () => {
      const result = updateUserSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('updateUserSchema passa com status informado (refine verdadeiro)', () => {
      const result = updateUserSchema.safeParse({ status: 'DISABLED' });
      expect(result.success).toBe(true);
    });
  });
});
