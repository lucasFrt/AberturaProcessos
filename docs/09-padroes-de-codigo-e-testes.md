# 09 - Padrões de Código e Testes

## TypeScript

`tsconfig.json` do backend (o do front herda o essencial, com `"jsx": "react-jsx"` e `"moduleResolution": "bundler"`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "baseUrl": "src",
    "paths": { "@/*": ["*"] }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Regras não negociáveis:

- `any` proibido. Para valor de origem externa, `unknown` + validação Zod.
- Sem `as` para contornar erro de tipo. Type guard ou parse.
- Retorno de função pública sempre anotado.
- `interface` para contratos (repositórios, providers), `type` para uniões e utilitários.
- Nenhum `enum` do TypeScript — usar `as const` + união (mesma decisão do banco, mantém uma só fonte).

## Convenções

| Item | Convenção | Exemplo |
| --- | --- | --- |
| Arquivos (backend) | `kebab-case` com sufixo de papel | `process.service.ts`, `authenticate.middleware.ts` |
| Arquivos (React) | `PascalCase` para componentes, `camelCase` para hooks | `ProcessCard.tsx`, `useBoard.ts` |
| Classes / interfaces | `PascalCase`, sem prefixo `I` | `ProcessRepository` |
| Funções e variáveis | `camelCase` | `resolveScope` |
| Constantes de módulo | `SCREAMING_SNAKE_CASE` | `DEFAULT_JOB_OPTIONS` |
| Tabelas no banco | `snake_case` plural via `@@map` | `process_history` |
| Colunas | `camelCase` (padrão do Prisma) | `clientCompanyId` |
| Rotas | `kebab-case` plural | `/processes/:id/documents` |
| Branches | `tipo/descrição-curta` | `feat/kanban-board` |
| Commits | Conventional Commits | `feat(process): move stage with audit trail` |

Idioma: **código em inglês** (identificadores, tipos, rotas), **conteúdo voltado ao usuário em
português** (mensagens de erro traduzidas no front, e-mails, labels). Comentários e documentação em
português.

## SOLID aplicado

**Single Responsibility.** Controller traduz HTTP; service tem regra; repositório persiste. Se um
service passa de ~250 linhas, provavelmente há mais de um caso de uso ali: extrair
(`ProcessService`, `ProcessStageService`, `DocumentService` são serviços distintos, não um só).

**Open/Closed.** Adicionar um provedor OAuth novo é adicionar uma estratégia Passport e um mapeamento
de perfil, sem editar `AuthService`. Trocar disco por Azure Blob é implementar `StorageProvider`, sem
tocar em `DocumentService`.

**Liskov.** `LocalDiskStorage` e um futuro `AzureBlobStorage` respeitam o mesmo contrato, incluindo o
comportamento de erro: arquivo ausente lança `FileNotFoundError`, não retorna `null` em um e lança no
outro.

**Interface Segregation.** Interfaces pequenas e específicas. Em vez de um `Repository` genérico com
20 métodos, cada repositório expõe só o que seus serviços usam. `Mailer` tem um método: `send`.

**Dependency Inversion.** Serviços recebem dependências por construtor, tipadas por interface do
domínio. Nenhum `new` de infraestrutura dentro de service; nenhum `import { PrismaClient }` em
`services/`. Um teste de arquitetura garante isso (ver abaixo).

## Clean Code

- Funções pequenas, um nível de abstração por função.
- Sem números/strings mágicos: `constants.ts` ou config.
- Early return em vez de `if` aninhado.
- Nome revela intenção: `resolveAccessScope`, não `getData`.
- Comentário explica **por que**, não **o que**. Se o "o que" precisa de comentário, renomeie.
- Erro nunca é engolido em silêncio. A única exceção é o enfileiramento de e-mail, que é deliberada,
  documentada e sempre com log em nível `error`.
- Sem exportação default no backend (nomes explícitos facilitam busca e refactor).

### Padrão de service

```ts
export class ProcessStageService {
  constructor(private readonly deps: ProcessStageServiceDeps) {}

  async moveStage(input: MoveStageInput): Promise<ProcessDetail> {
    const { processId, toStageId, note, actor } = input;

    const process = await this.deps.processRepository.findById(processId, actor.scope);
    if (!process) throw new NotFoundError('PROCESS_NOT_FOUND', 'Processo não encontrado.');

    const toStage = await this.deps.stageRepository.findById(toStageId);
    if (!toStage) throw new NotFoundError('STAGE_NOT_FOUND', 'Etapa não encontrada.');

    if (process.currentStageId === toStageId) {
      throw new ConflictError('CONFLICT', 'O processo já está nesta etapa.');
    }

    const fromStage = await this.deps.stageRepository.findById(process.currentStageId);
    const completedAt = toStage.isFinal ? new Date() : null;

    const updated = await this.deps.processRepository.transaction(async (tx) => {
      const result = await tx.processes.updateStage(processId, {
        currentStageId: toStageId,
        stageChangedAt: new Date(),
        completedAt,
      });

      await tx.history.create({
        processId,
        action: 'STAGE_CHANGED',
        fromStageId: process.currentStageId,
        toStageId,
        actorId: actor.userId,
        description: `Etapa alterada de ${fromStage?.name ?? '—'} para ${toStage.name}`,
        metadata: note ? JSON.stringify({ note }) : null,
      });

      return result;
    });

    await this.notify(updated, fromStage, toStage, actor, note);
    return updated;
  }
}
```

Características a replicar: dependências por construtor; validações com early return e erro de
domínio; escrita atômica junto do histórico; efeitos colaterais (fila e socket) depois do commit, em
um método privado separado.

## ESLint e Prettier

ESLint com `@typescript-eslint` (`recommended-type-checked`), `import/order` e, no front,
`eslint-plugin-react-hooks` + `jsx-a11y`. Regras específicas do projeto:

```js
rules: {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/explicit-function-return-type': ['warn', { allowExpressions: true }],
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  'no-console': ['error', { allow: [] }],  // usar o logger
  'import/no-cycle': 'error',
}
```

Barreira arquitetural via `no-restricted-imports`:

```js
{
  files: ['src/services/**/*.ts', 'src/domain/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        { name: '@prisma/client', message: 'Services e domain não conhecem o Prisma. Use a interface de repositório.' },
        { name: 'express', message: 'Services não conhecem HTTP.' },
      ],
      patterns: ['@/infra/*'],
    }],
  },
}
```

Prettier: 100 colunas, aspas simples, trailing comma, ponto e vírgula.

Pre-commit com Husky + lint-staged: `eslint --fix` e `prettier --write` nos arquivos alterados, e
`tsc --noEmit` no repositório inteiro.

## Testes

Jest + ts-jest. `testEnvironment: 'node'` no backend. Front usa Vitest + Testing Library (mesma API
de asserção, integração melhor com Vite).

```
tests/
├── unit/               # services e utilitários, tudo em memória
├── integration/        # HTTP real via Supertest, banco de teste real
└── helpers/
    ├── fakes/          # implementações em memória das interfaces
    ├── factories/      # builders de entidade (buildProcess, buildUser)
    └── test-app.ts     # monta o Express com o container de teste
```

### Testes unitários

Sem banco, sem Redis, sem HTTP. Fakes implementam as interfaces do domínio:

```ts
export class InMemoryProcessRepository implements ProcessRepository {
  readonly items: Process[] = [];

  async findById(id: string, scope: AccessScope): Promise<Process | null> {
    const found = this.items.find((p) => p.id === id && !p.deletedAt);
    if (!found) return null;
    if (scope.kind === 'ALL') return found;
    const allowed =
      scope.companyIds.includes(found.clientCompanyId) ||
      (found.requestingCompanyId !== null && scope.companyIds.includes(found.requestingCompanyId));
    return allowed ? found : null;
  }
  // ...
}
```

O fake replica a semântica de escopo do repositório real — inclusive o retorno `null` para fora de
escopo. Se ele apenas ignorasse o escopo, os testes de isolamento passariam sem provar nada.

Casos obrigatórios por service:

- Caminho feliz.
- Cada erro esperado: não encontrado, conflito, sem permissão.
- Regra de escopo: CLIENT de outra organização não alcança o recurso.
- Efeitos colaterais: fila chamada com o payload correto, evento emitido com as salas corretas.
- Transação: se a escrita do histórico falha, a mudança de etapa não persiste.

### Testes de integração

Sobem o app real com Supertest, contra um banco SQL Server dedicado
(`DATABASE_URL` de `.env.test`, banco `abertura_processos_test`). Redis e SMTP são substituídos por
fakes injetados no container de teste — a suíte não deve depender de container externo além do banco.

```ts
beforeAll(async () => {
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: TEST_DB_URL } });
});

beforeEach(async () => {
  await truncateAll(prisma);  // ordem reversa de FK
  await seedBaseline(prisma); // org interna, admin, etapas
});
```

Fluxos com cobertura obrigatória:

1. Registro com domínio conhecido → `ACTIVE` + token; domínio desconhecido → `PENDING` sem token.
2. Login inválido → `401`; conta pendente → `403 ACCOUNT_PENDING`.
3. Refresh rotaciona o token; reuso de token revogado → `401` e revogação da família.
4. **Isolamento:** cliente da org A recebe `404` no processo da org B, e a listagem dele não contém
   nenhum processo de B. Repetir para detalhe, histórico, documentos e download.
5. Criação de processo gera `code` sequencial e histórico `PROCESS_CREATED`.
6. CLIENT recebe `403` ao tentar mover etapa; OPERATIONAL move e gera `STAGE_CHANGED`.
7. Etapa final grava `completedAt`; sair dela limpa.
8. Exclusão de etapa com processos → `409 STAGE_NOT_EMPTY`.
9. Reordenação persiste a nova ordem.
10. Upload → download devolve os mesmos bytes e o nome original; upload gera `DOCUMENT_ADDED`.
11. Aprovação de pendente por ADMIN habilita o login; não-ADMIN recebe `403` no mesmo endpoint.
12. Métricas do dashboard batem com o dataset semeado, incluindo o tempo médio de conclusão.
13. Rate limit de login retorna `429` após o limite.
14. Todos os valores de `domain/enums` são aceitos pelas `CHECK constraints` do banco.

### Teste de arquitetura

Guarda as regras que o ESLint não cobre e que erodem primeiro sob pressa:

```ts
it('nenhum service importa Prisma diretamente', async () => {
  const files = await glob('src/services/**/*.ts');
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    expect(content).not.toMatch(/from ['"]@prisma\/client['"]/);
    expect(content).not.toMatch(/from ['"].*infra\/prisma/);
  }
});
```

### Cobertura

```ts
coverageThreshold: {
  global: { branches: 60, functions: 70, lines: 70, statements: 70 },
  './src/services/': { branches: 75, functions: 85, lines: 85, statements: 85 },
  './src/http/middlewares/': { branches: 80, functions: 85, lines: 85, statements: 85 },
}
```

Limites maiores em service e middleware porque é onde vivem regra de negócio e autorização.
Cobertura é piso, não meta: os 14 fluxos acima valem mais que o número.

### Scripts

```json
{
  "test": "jest --runInBand",
  "test:unit": "jest tests/unit",
  "test:integration": "jest tests/integration --runInBand",
  "test:coverage": "jest --coverage --runInBand"
}
```

`--runInBand` evita que suítes paralelas briguem pelo mesmo banco de teste. Nunca usar `--watch` em
execução automatizada.

## Logs

Pino, com redação de campos sensíveis configurada no logger, não confiada à disciplina de quem
escreve o log:

```ts
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie',
      'password', '*.password', 'passwordHash', '*.passwordHash',
      'accessToken', 'refreshToken', 'tokenHash',
    ],
    censor: '[REDACTED]',
  },
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});
```

`pino-http` gera `requestId` (ULID) por requisição, propagado no envelope de erro e no header
`X-Request-Id`. Um erro relatado pelo usuário fica localizável no log por esse id.

Níveis: `error` (falha que exige ação), `warn` (degradação, ex.: reuso de refresh token, Redis fora),
`info` (ciclo de vida e ações de negócio relevantes), `debug` (desenvolvimento).

Em produção, saída em JSON no stdout, capturada pelo NSSM em arquivo com rotação. Ver documento 11.
