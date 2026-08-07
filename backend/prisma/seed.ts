/**
 * Seed idempotente (docs/04-modelo-de-dados.md, seção "Seed").
 * Roda com: npm run seed
 *
 * Cria o mínimo para o sistema funcionar:
 * 1. Organization interna (a própria trading)
 * 2. EmailDomain dela, com defaultRole=OPERATIONAL e autoApprove=true
 * 3. Usuário ADMIN a partir de ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD
 * 4. Etapas iniciais do Kanban: Entrada, Em Andamento, Concluído
 * 5. Sequência do ano corrente em ProcessSequence
 *
 * Todos os passos usam `upsert` por chave natural, então rodar o seed
 * várias vezes não duplica nada.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_COST = 12;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória para o seed ausente: ${name}`);
  }
  return value;
}

async function seedInternalOrganization(): Promise<{ organizationId: string }> {
  const orgName = requiredEnv('INTERNAL_ORG_NAME');
  const domain = requiredEnv('INTERNAL_EMAIL_DOMAIN').trim().toLowerCase();

  const organization = await prisma.organization.upsert({
    where: { id: 'org-internal' },
    update: { name: orgName, isInternal: true, isActive: true },
    create: {
      id: 'org-internal',
      name: orgName,
      isInternal: true,
      isActive: true,
    },
  });

  await prisma.emailDomain.upsert({
    where: { domain },
    update: {
      organizationId: organization.id,
      defaultRole: 'OPERATIONAL',
      autoApprove: true,
    },
    create: {
      domain,
      organizationId: organization.id,
      defaultRole: 'OPERATIONAL',
      autoApprove: true,
    },
  });

  console.log(`✔ Organization interna "${organization.name}" (domínio ${domain})`);
  return { organizationId: organization.id };
}

async function seedAdminUser(organizationId: string): Promise<void> {
  const email = requiredEnv('ADMIN_SEED_EMAIL').trim().toLowerCase();
  const password = requiredEnv('ADMIN_SEED_PASSWORD');
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      role: 'ADMIN',
      status: 'ACTIVE',
      accessScope: 'ORGANIZATION',
      organizationId,
      passwordHash,
    },
    create: {
      name: 'Administrador',
      email,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      accessScope: 'ORGANIZATION',
      organizationId,
      approvedAt: new Date(),
    },
  });

  await prisma.userIdentity.upsert({
    where: { provider_providerUserId: { provider: 'LOCAL', providerUserId: email } },
    update: { userId: user.id },
    create: { userId: user.id, provider: 'LOCAL', providerUserId: email },
  });

  console.log(`✔ Usuário ADMIN "${email}"`);
}

async function seedKanbanStages(): Promise<void> {
  const stages = [
    { name: 'Entrada', order: 0, color: '#1677ff', isFinal: false },
    { name: 'Em Andamento', order: 1, color: '#faad14', isFinal: false },
    { name: 'Concluído', order: 2, color: '#52c41a', isFinal: true },
  ];

  for (const stage of stages) {
    await prisma.kanbanStage.upsert({
      where: { name: stage.name },
      update: { order: stage.order, color: stage.color, isFinal: stage.isFinal },
      create: stage,
    });
  }

  console.log(`✔ ${stages.length} etapas do Kanban (Entrada, Em Andamento, Concluído)`);
}

async function seedProcessSequence(): Promise<void> {
  const year = new Date().getFullYear();

  await prisma.processSequence.upsert({
    where: { year },
    update: {},
    create: { year, lastNumber: 0 },
  });

  console.log(`✔ Sequência de código de processos para o ano ${year}`);
}

async function main(): Promise<void> {
  const { organizationId } = await seedInternalOrganization();
  await seedAdminUser(organizationId);
  await seedKanbanStages();
  await seedProcessSequence();
}

main()
  .catch((error: unknown) => {
    console.error('Falha ao executar o seed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
