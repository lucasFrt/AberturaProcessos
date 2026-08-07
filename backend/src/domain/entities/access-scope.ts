/**
 * Escopo de acesso resolvido para o usuário autenticado (docs/06, seção
 * "Resolução do escopo"). Entra pela assinatura de todo método de leitura
 * dos repositórios — esquecer de aplicá-lo é erro de compilação, não bug
 * silencioso de vazamento de dados (docs/03-arquitetura.md, RNF-01).
 */
export type AccessScope = { kind: 'ALL' } | { kind: 'COMPANIES'; companyIds: string[] };
