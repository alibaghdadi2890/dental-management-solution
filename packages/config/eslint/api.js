import boundaries from 'eslint-plugin-boundaries';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import { base } from './base.js';

const sameModule = { module: '{{from.element.captured.module}}' };

/**
 * NestJS backend: enforces the CLAUDE.md §4 module boundaries.
 * @param {{ tsconfigRootDir: string }} options
 */
export function api({ tsconfigRootDir }) {
  const project = `${tsconfigRootDir}/tsconfig.json`;
  return defineConfig(
    base({ tsconfigRootDir }),
    {
      languageOptions: { globals: globals.node },
    },
    {
      files: ['src/**/*.ts'],
      plugins: { boundaries, 'import-x': importX },
      settings: {
        'import/resolver': { typescript: { alwaysTryTypes: true, project } },
        'import-x/resolver-next': [createTypeScriptImportResolver({ project })],
        'import-x/extensions': ['.ts', '.js'],
        'import-x/parsers': { '@typescript-eslint/parser': ['.ts'] },
        'boundaries/include': ['src/**/*.ts'],
        'boundaries/elements': [
          { type: 'kernel', pattern: 'src/platform/kernel' },
          { type: 'platform', pattern: 'src/platform/*', capture: ['area'] },
          { type: 'domain', pattern: 'src/modules/*/domain', capture: ['module'] },
          { type: 'module', pattern: 'src/modules/*', capture: ['module'] },
          // Anything else directly under src/ (main.ts, app.module.ts). Must stay last.
          { type: 'app', pattern: 'src' },
        ],
      },
      rules: {
        'boundaries/dependencies': [
          'error',
          {
            default: 'disallow',
            message:
              '{{from.element.type}} may not import this {{to.element.type}} file (CLAUDE.md §4 boundary rules)',
            policies: [
              {
                from: { element: { type: 'kernel' } },
                allow: { to: { element: { type: 'kernel' } } },
              },
              {
                from: { element: { type: 'platform' } },
                allow: { to: { element: { type: ['platform', 'kernel'] } } },
              },
              {
                from: { element: { type: 'domain' } },
                allow: {
                  to: [
                    { element: { type: 'kernel' } },
                    { element: { type: 'domain', captured: sameModule } },
                  ],
                },
              },
              {
                from: { element: { type: 'module' } },
                allow: {
                  to: [
                    { element: { type: ['platform', 'kernel'] } },
                    { element: { type: ['module', 'domain'], captured: sameModule } },
                    { element: { type: 'module', fileInternalPath: 'index.ts' } },
                  ],
                },
              },
              {
                from: { element: { type: 'app' } },
                allow: {
                  to: [
                    { element: { type: ['app', 'platform', 'kernel'] } },
                    { element: { type: 'module', fileInternalPath: 'index.ts' } },
                  ],
                },
              },
            ],
          },
        ],
        'import-x/no-cycle': 'error',
      },
    },
    {
      files: ['src/modules/*/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '@nestjs/*',
                  'nestjs-*',
                  'drizzle-orm',
                  'drizzle-orm/*',
                  'pg',
                  'bullmq',
                  'ioredis',
                  '@aws-sdk/*',
                  'express',
                ],
                message:
                  'domain/ is pure TypeScript: no Nest, no DB, no I/O (CLAUDE.md §4 rule 5).',
              },
            ],
          },
        ],
      },
    },
  );
}
