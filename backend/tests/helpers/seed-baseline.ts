import type { PrismaClient } from '@prisma/client';

/**
 * Estado mínimo para os testes de integração (docs/09): uma organização
 * interna com domínio reconhecido (autoApprove) e uma organização externa
 * sem domínio, usada para os cenários de PENDING/isolamento.
 */
export async function seedBaseline(prisma: PrismaClient): Promise<{
  internalOrganizationId: string;
}> {
  const internal = await prisma.organization.create({
    data: { id: 'org-internal-test', name: 'Opusce Teste', isInternal: true },
  });

  await prisma.emailDomain.create({
    data: {
      domain: 'opusce-teste.com.br',
      organizationId: internal.id,
      defaultRole: 'OPERATIONAL',
      autoApprove: true,
    },
  });

  return { internalOrganizationId: internal.id };
}
