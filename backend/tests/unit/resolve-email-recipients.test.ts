import type { RecipientQueryClient } from '@/workers/resolve-email-recipients';
import { resolveEmailRecipients } from '@/workers/resolve-email-recipients';

interface FakeUserRow {
  email: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'REJECTED';
  role: 'CLIENT' | 'OPERATIONAL' | 'ADMIN';
}

/**
 * Fake mínimo de Prisma (só o formato usado por `resolveEmailRecipients`) —
 * evita depender de um banco real para testar a regra de filtro (docs/12,
 * Tarefa 12: "pode usar um fake de Prisma/repositório mínimo").
 */
function buildFakePrisma(rows: FakeUserRow[]): RecipientQueryClient {
  return {
    user: {
      findMany(args): Promise<{ email: string }[]> {
        const { status, role } = args.where;
        return Promise.resolve(
          rows
            .filter((row) => row.status === status && role.in.some((r) => r === row.role))
            .map((row) => ({ email: row.email })),
        );
      },
    },
  };
}

describe('resolveEmailRecipients', () => {
  it('filtra apenas usuários ACTIVE com papel OPERATIONAL ou ADMIN', async () => {
    const prisma = buildFakePrisma([
      { email: 'op1@x.com', status: 'ACTIVE', role: 'OPERATIONAL' },
      { email: 'admin1@x.com', status: 'ACTIVE', role: 'ADMIN' },
      { email: 'client1@x.com', status: 'ACTIVE', role: 'CLIENT' },
      { email: 'op-disabled@x.com', status: 'DISABLED', role: 'OPERATIONAL' },
      { email: 'op-pending@x.com', status: 'PENDING', role: 'OPERATIONAL' },
    ]);

    const recipients = await resolveEmailRecipients(prisma);

    expect(recipients.sort()).toEqual(['admin1@x.com', 'op1@x.com']);
  });

  it('lista vazia não lança erro — retorna array vazio', async () => {
    const prisma = buildFakePrisma([]);

    const recipients = await resolveEmailRecipients(prisma);

    expect(recipients).toEqual([]);
  });

  it('lista vazia quando só há CLIENT ativos', async () => {
    const prisma = buildFakePrisma([{ email: 'client1@x.com', status: 'ACTIVE', role: 'CLIENT' }]);

    const recipients = await resolveEmailRecipients(prisma);

    expect(recipients).toEqual([]);
  });
});
