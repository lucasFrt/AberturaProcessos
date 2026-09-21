import {
  ACCESS_SCOPES,
  AUTH_PROVIDERS,
  COMPANY_DOCUMENT_TYPES,
  HISTORY_ACTIONS,
  INTAKE_CHANNELS,
  INTAKE_EVENT_KINDS,
  INTAKE_EVENT_STATUSES,
  RECORD_SOURCES,
  ROLES,
  USER_STATUSES,
} from '@/domain/enums';
import { prisma } from '@/infra/prisma/client';
import { closeSharedRedisClient } from '@/infra/queue/connection';

/**
 * Fluxo 14 do documento 09: "Todos os valores de `domain/enums` são
 * aceitos pelas CHECK constraints do banco." (docs/09, docs/12 Tarefa 22).
 *
 * Abordagem (a) do plano: consulta o banco de teste real
 * (`sys.check_constraints`) para extrair os valores efetivamente aceitos
 * por cada constraint, em vez de reimplementar um parser de SQL fragil
 * contra o arquivo de migration. Isso prova o comportamento do banco real
 * de teste, não uma cópia estática do texto da migration que poderia
 * divergir silenciosamente se alguém rodasse uma migration manual fora do
 * fluxo do Prisma.
 *
 * Cada CHECK constraint no banco usa `IN ('A','B','C')` (ver migration
 * 20260807190618_add_check_constraints) — o SQL Server preserva esse texto
 * em `sys.check_constraints.definition`, então extrair os literais entre
 * aspas simples via regex é suficiente e não é um parser de SQL genérico.
 */

interface CheckConstraintRow {
  definition: string;
}

/** Extrai os literais de string de uma definição de CHECK constraint tipo `IN ('A','B')`. */
function extractAllowedValues(definition: string): string[] {
  const matches = definition.match(/'([^']*)'/g) ?? [];
  return matches.map((literal) => literal.slice(1, -1));
}

async function allowedValuesForConstraint(constraintName: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<CheckConstraintRow[]>(
    `SELECT OBJECT_DEFINITION(object_id) AS definition
     FROM sys.check_constraints
     WHERE name = @P1`,
    constraintName,
  );

  if (rows.length === 0) {
    throw new Error(`CHECK constraint '${constraintName}' não encontrada no banco de teste.`);
  }

  return extractAllowedValues(rows[0]?.definition ?? '');
}

function expectSameSet(actual: string[], expected: readonly string[], label: string): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  expect({ label, values: actualSorted }).toEqual({ label, values: expectedSorted });
}

describe('Consistência entre domain/enums e as CHECK constraints do banco (integração)', () => {
  afterEach(async () => {
    // Limpa apenas as linhas inseridas por este arquivo — outros arquivos de
    // integração usam `truncateAll` + `seedBaseline` no seu próprio ciclo, e
    // este arquivo não depende de nenhum dado de baseline.
    await prisma.$executeRawUnsafe(`DELETE FROM [users] WHERE id LIKE 'chk-%'`);
  });

  afterAll(async () => {
    await closeSharedRedisClient();
    await prisma.$disconnect();
  });

  it('CK_users_role aceita exatamente os valores de ROLES', async () => {
    const allowed = await allowedValuesForConstraint('CK_users_role');
    expectSameSet(allowed, ROLES, 'CK_users_role');
  });

  it('CK_email_domains_default_role aceita exatamente os valores de ROLES', async () => {
    const allowed = await allowedValuesForConstraint('CK_email_domains_default_role');
    expectSameSet(allowed, ROLES, 'CK_email_domains_default_role');
  });

  it('CK_users_status aceita exatamente os valores de USER_STATUSES', async () => {
    const allowed = await allowedValuesForConstraint('CK_users_status');
    expectSameSet(allowed, USER_STATUSES, 'CK_users_status');
  });

  it('CK_users_access_scope aceita exatamente os valores de ACCESS_SCOPES', async () => {
    const allowed = await allowedValuesForConstraint('CK_users_access_scope');
    expectSameSet(allowed, ACCESS_SCOPES, 'CK_users_access_scope');
  });

  it('CK_user_identities_provider aceita exatamente os valores de AUTH_PROVIDERS', async () => {
    const allowed = await allowedValuesForConstraint('CK_user_identities_provider');
    expectSameSet(allowed, AUTH_PROVIDERS, 'CK_user_identities_provider');
  });

  it('CK_process_history_action aceita exatamente os valores de HISTORY_ACTIONS', async () => {
    const allowed = await allowedValuesForConstraint('CK_process_history_action');
    expectSameSet(allowed, HISTORY_ACTIONS, 'CK_process_history_action');
  });

  // Tarefa 24 (docs/13, decisões 5 e 7).
  it('CK_companies_document_type aceita exatamente os valores de COMPANY_DOCUMENT_TYPES', async () => {
    const allowed = await allowedValuesForConstraint('CK_companies_document_type');
    expectSameSet(allowed, COMPANY_DOCUMENT_TYPES, 'CK_companies_document_type');
  });

  it('CK_processes_source aceita exatamente os valores de RECORD_SOURCES', async () => {
    const allowed = await allowedValuesForConstraint('CK_processes_source');
    expectSameSet(allowed, RECORD_SOURCES, 'CK_processes_source');
  });

  it('CK_documents_source aceita exatamente os valores de RECORD_SOURCES', async () => {
    const allowed = await allowedValuesForConstraint('CK_documents_source');
    expectSameSet(allowed, RECORD_SOURCES, 'CK_documents_source');
  });

  // Tarefas 25 e 27 (docs/13, decisões 4 e 9).
  it('CK_intake_events_channel aceita exatamente os valores de INTAKE_CHANNELS', async () => {
    const allowed = await allowedValuesForConstraint('CK_intake_events_channel');
    expectSameSet(allowed, INTAKE_CHANNELS, 'CK_intake_events_channel');
  });

  it('CK_intake_events_kind aceita exatamente os valores de INTAKE_EVENT_KINDS', async () => {
    const allowed = await allowedValuesForConstraint('CK_intake_events_kind');
    expectSameSet(allowed, INTAKE_EVENT_KINDS, 'CK_intake_events_kind');
  });

  it('CK_intake_events_status aceita exatamente os valores de INTAKE_EVENT_STATUSES', async () => {
    const allowed = await allowedValuesForConstraint('CK_intake_events_status');
    expectSameSet(allowed, INTAKE_EVENT_STATUSES, 'CK_intake_events_status');
  });

  /**
   * Prova, contra o banco real, que um valor fora do enum é de fato
   * rejeitado — não basta a constraint existir, ela precisa estar
   * efetivamente aplicada à tabela (ex.: não fica "desabilitada" via
   * `WITH NOCHECK`, o que faria a constraint existir sem ser exercitada).
   */
  it('rejeita um valor de role fora do enum na tabela users (CK_users_role)', async () => {
    const insert = prisma.$executeRawUnsafe(
      `INSERT INTO [users] (id, name, email, role, status, accessScope, createdAt, updatedAt)
       VALUES (@P1, 'Usuario Invalido', @P2, 'NAO_EXISTE', 'ACTIVE', 'ORGANIZATION', SYSUTCDATETIME(), SYSUTCDATETIME())`,
      'chk-inv-role',
      'invalido-check-constraint@teste.com.br',
    );

    await expect(insert).rejects.toThrow(/CK_users_role/);
  });

  it('aceita cada valor válido de ROLES na tabela users (prova positiva da constraint)', async () => {
    for (const [index, role] of ROLES.entries()) {
      const id = `chk-valid-role-${index}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO [users] (id, name, email, role, status, accessScope, createdAt, updatedAt)
         VALUES (@P1, 'Usuario Valido', @P2, @P3, 'ACTIVE', 'ORGANIZATION', SYSUTCDATETIME(), SYSUTCDATETIME())`,
        id,
        `valido-${index}-check-constraint@teste.com.br`,
        role,
      );
    }

    const count = await prisma.user.count({ where: { id: { startsWith: 'chk-valid-role-' } } });
    expect(count).toBe(ROLES.length);
  });
});
