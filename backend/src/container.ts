import type { PrismaClient } from '@prisma/client';

/**
 * Ponto único de composição manual de dependências (docs/03-arquitetura.md,
 * seção "Injeção de dependência"). Sem decorators, sem reflect-metadata:
 * cada repositório/provider é instanciado aqui e injetado por construtor
 * nos services correspondentes.
 *
 * Ainda vazio nesta tarefa — os primeiros repositórios e services chegam na
 * Tarefa 4 (autenticação local e JWT).
 */
export interface Container {
  prisma: PrismaClient;
}

export function buildContainer(prisma: PrismaClient): Container {
  return { prisma };
}
