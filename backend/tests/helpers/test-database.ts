import type { PrismaClient } from '@prisma/client';

/**
 * Limpa todas as tabelas de domínio na ordem reversa de FK
 * (docs/09-padroes-de-codigo-e-testes.md). Preserva `_prisma_migrations`.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tablesInReverseFkOrder = [
    'intake_events',
    'intake_cursors',
    'ilog_sync_state',
    'process_identifiers',
    'process_history',
    'documents',
    'processes',
    'process_sequences',
    'kanban_stages',
    'refresh_tokens',
    'api_keys',
    'user_identities',
    'user_companies',
    'users',
    'companies',
    'email_domains',
    'organizations',
  ];

  for (const table of tablesInReverseFkOrder) {
    await prisma.$executeRawUnsafe(`DELETE FROM [${table}]`);
  }
}
