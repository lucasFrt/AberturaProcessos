const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const prettierConfig = require('eslint-config-prettier');

module.exports = tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['warn', { allowExpressions: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-console': 'error',
      'import/no-cycle': 'error',
      'import/order': [
        'warn',
        { alphabetize: { order: 'asc', caseInsensitive: true }, 'newlines-between': 'always' },
      ],
    },
  },
  // Scripts de CLI (seed) podem usar console diretamente.
  {
    files: ['**/prisma/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Barreira arquitetural: services e domain não conhecem Prisma nem Express (doc 09 / doc 03)
  {
    files: ['src/services/**/*.ts', 'src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'Services e domain não conhecem o Prisma. Use a interface de repositório.',
            },
            { name: 'express', message: 'Services não conhecem HTTP.' },
          ],
          patterns: ['**/infra/*'],
        },
      ],
    },
  },
  prettierConfig,
);
