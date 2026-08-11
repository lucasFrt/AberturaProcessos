/**
 * Resolução dos destinatários (docs/07, seção "Resolução dos
 * destinatários"). Feita no worker, não no produtor, para que o payload do
 * job não carregue e-mails e a lista reflita o estado no momento do envio:
 *
 *   SELECT email FROM users WHERE status = 'ACTIVE' AND role IN ('OPERATIONAL', 'ADMIN')
 *
 * Extraída como função isolada (em vez de inline no processor) para ser
 * testável sem precisar de um Prisma real — recebe qualquer objeto com o
 * formato mínimo usado aqui, em vez do tipo completo (e complexo de
 * sobrecargas) de `PrismaClient['user']['findMany']`.
 */
export interface RecipientQueryClient {
  user: {
    findMany(args: {
      where: { status: 'ACTIVE'; role: { in: ('OPERATIONAL' | 'ADMIN')[] } };
      select: { email: true };
    }): Promise<{ email: string }[]>;
  };
}

export async function resolveEmailRecipients(prisma: RecipientQueryClient): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE', role: { in: ['OPERATIONAL', 'ADMIN'] } },
    select: { email: true },
  });

  return users.map((user) => user.email);
}
