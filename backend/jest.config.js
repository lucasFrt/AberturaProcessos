/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  clearMocks: true,
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Sem isso, Jest inclui no universo de cobertura qualquer arquivo
  // carregado durante os testes — inclusive tests/helpers/fakes/**, que são
  // dublês de teste, não código de produção. Os limites de docs/09 são
  // sobre src/, então restringimos a coleta a src/ para que os fakes não
  // distorçam o "global" (nem para cima, nem para baixo).
  collectCoverageFrom: ['src/**/*.ts'],
  // docs/09-padroes-de-codigo-e-testes.md, seção "Cobertura". Piso, não
  // meta: os 14 fluxos de integração valem mais que o número em si.
  coverageThreshold: {
    global: { branches: 60, functions: 70, lines: 70, statements: 70 },
    './src/services/': { branches: 75, functions: 85, lines: 85, statements: 85 },
    './src/http/middlewares/': { branches: 80, functions: 85, lines: 85, statements: 85 },
  },
};
