import type { PrismaClient } from '@prisma/client';

/**
 * Estado mínimo para os testes de integração (docs/09): uma organização
 * interna com domínio reconhecido (autoApprove, papel OPERATIONAL) e uma
 * organização de cliente com domínio próprio (autoApprove, papel CLIENT) —
 * usada nos testes que precisam de um usuário ACTIVE com papel CLIENT
 * (ex.: Tarefa 6, rate limit por papel). Um e-mail de domínio desconhecido
 * cobre os cenários de PENDING/isolamento.
 */
export async function seedBaseline(prisma: PrismaClient): Promise<{
  internalOrganizationId: string;
  clientOrganizationId: string;
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

  const client = await prisma.organization.create({
    data: { id: 'org-client-test', name: 'Cliente Teste', isInternal: false },
  });

  await prisma.emailDomain.create({
    data: {
      domain: 'clientex-teste.com.br',
      organizationId: client.id,
      defaultRole: 'CLIENT',
      autoApprove: true,
    },
  });

  return { internalOrganizationId: internal.id, clientOrganizationId: client.id };
}
