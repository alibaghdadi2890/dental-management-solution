import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Shared rules for every TypeScript package.
 * @param {{ tsconfigRootDir: string }} options
 */
export function base({ tsconfigRootDir }) {
  return defineConfig(
    {
      ignores: [
        'dist/**',
        'coverage/**',
        '**/*.gen.ts',
        'eslint.config.js',
        'eslint.config.mjs',
        '*.config.ts',
        '*.config.mts',
        'playwright-report/**',
        'test-results/**',
      ],
    },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        'no-warning-comments': ['error', { terms: ['todo', 'fixme'], location: 'start' }],
      },
    },
    {
      files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.int-spec.ts', 'test/**', 'e2e/**'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/require-await': 'off',
      },
    },
    prettier,
  );
}
