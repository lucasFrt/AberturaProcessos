import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Segunda camada de garantia da barreira arquitetural (docs/03, docs/09):
 * `src/services/**` e `src/domain/**` não podem importar `@prisma/client`,
 * `express`, nem nada de `infra/prisma`, `infra/queue`, `infra/mail`,
 * `infra/storage` ou `infra/realtime`. O ESLint (`no-restricted-imports` em
 * `eslint.config.js`) já cobre isso, mas roda como ferramenta separada —
 * este teste garante a regra mesmo que o lint não seja executado (ex.: só
 * `npm test` num pipeline mais permissivo), rodando via Jest como o resto
 * da suíte.
 *
 * Implementado com um scanner recursivo simples (`fs.readdirSync`), sem
 * adicionar dependência nova: `glob`/`fast-glob` não são dependências
 * diretas do projeto (só aparecem de forma transitiva via outras libs), e
 * depender delas sem declará-las no `package.json` quebraria no primeiro
 * `npm dedupe`/atualização que as remova da árvore.
 */

const SRC_ROOT = path.resolve(__dirname, '..', '..', 'src');

const FORBIDDEN_INFRA_PATTERNS = [
  /from ['"]@\/infra\/prisma/,
  /from ['"]@\/infra\/queue/,
  /from ['"]@\/infra\/mail/,
  /from ['"]@\/infra\/storage/,
  /from ['"]@\/infra\/realtime/,
  /require\(['"]@\/infra\/prisma/,
  /require\(['"]@\/infra\/queue/,
  /require\(['"]@\/infra\/mail/,
  /require\(['"]@\/infra\/storage/,
  /require\(['"]@\/infra\/realtime/,
];

const FORBIDDEN_PACKAGE_PATTERNS = [
  /from ['"]@prisma\/client['"]/,
  /from ['"]express['"]/,
  /require\(['"]@prisma\/client['"]\)/,
  /require\(['"]express['"]\)/,
];

/** Lista recursivamente todos os arquivos `.ts` sob `dir`. */
function listTsFilesRecursively(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listTsFilesRecursively(fullPath));
      continue;
    }

    if (stats.isFile() && entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function scanDirectory(subdir: string): string[] {
  const dir = path.join(SRC_ROOT, subdir);
  return listTsFilesRecursively(dir);
}

describe('Teste de arquitetura: nenhum service ou domain importa infraestrutura diretamente', () => {
  const servicesFiles = scanDirectory('services');
  const domainFiles = scanDirectory('domain');
  const filesToCheck = [...servicesFiles, ...domainFiles];

  // Falha-forte: se o scanner não encontrar nenhum arquivo, o teste "passa"
  // sem provar nada. Garante que os diretórios de fato existem e têm conteúdo.
  it('encontra arquivos em src/services e src/domain para verificar', () => {
    expect(servicesFiles.length).toBeGreaterThan(0);
    expect(domainFiles.length).toBeGreaterThan(0);
  });

  it.each(filesToCheck.map((file) => [path.relative(SRC_ROOT, file), file] as const))(
    'nenhum import proibido em %s',
    (_relativePath, file) => {
      const content = readFileSync(file, 'utf8');

      for (const pattern of FORBIDDEN_PACKAGE_PATTERNS) {
        expect(content).not.toMatch(pattern);
      }
      for (const pattern of FORBIDDEN_INFRA_PATTERNS) {
        expect(content).not.toMatch(pattern);
      }
    },
  );

  /**
   * Prova que o teste de fato falha quando a regra é violada (docs/12,
   * Tarefa 22, "verificar quebrando de propósito"). Simula o conteúdo de
   * um arquivo violador sem tocar em código real: aplica a mesma lógica de
   * verificação usada acima contra uma string fixture.
   */
  it('detecta violação simulada: import de @prisma/client em conteúdo de arquivo fixture', () => {
    const fixtureContent = `import { PrismaClient } from '@prisma/client';\n\nexport class FakeService {}\n`;

    const hasForbiddenImport = FORBIDDEN_PACKAGE_PATTERNS.some((pattern) =>
      pattern.test(fixtureContent),
    );

    expect(hasForbiddenImport).toBe(true);
  });

  it('detecta violação simulada: import de infra/queue em conteúdo de arquivo fixture', () => {
    const fixtureContent = `import { BullMqQueueProvider } from '@/infra/queue/bullmq-queue-provider';\n`;

    const hasForbiddenImport = FORBIDDEN_INFRA_PATTERNS.some((pattern) =>
      pattern.test(fixtureContent),
    );

    expect(hasForbiddenImport).toBe(true);
  });
});
