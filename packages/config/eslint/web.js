import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import { base } from './base.js';

// Physical-direction utilities break RTL; use ms-/me-/ps-/pe-/start-/end-/text-start instead.
const PHYSICAL_CLASS =
  '/(^|[\\s:])-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-|(^|[\\s:])(text-left|text-right|float-left|float-right|border-l|border-r)(\\s|$)/';
const physicalClassMessage =
  'Use logical Tailwind utilities (ms-/me-/ps-/pe-/start-/end-/text-start) so RTL works (CLAUDE.md §13).';
const classContexts = [
  "JSXAttribute[name.name='className']",
  'CallExpression[callee.name=/^(cn|cva|clsx)$/]',
];

/**
 * React SPA: hooks rules, i18n-ready JSX text, RTL-safe class names.
 * @param {{ tsconfigRootDir: string }} options
 */
export function web({ tsconfigRootDir }) {
  return defineConfig(
    base({ tsconfigRootDir }),
    {
      files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'],
      languageOptions: { globals: globals.browser },
    },
    {
      files: ['src/**/*.{ts,tsx}'],
      plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh, i18next },
      rules: {
        ...reactHooks.configs.recommended.rules,
        'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
        'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
        'no-restricted-syntax': [
          'error',
          ...classContexts.flatMap((context) => [
            {
              selector: `${context} Literal[value=${PHYSICAL_CLASS}]`,
              message: physicalClassMessage,
            },
            {
              selector: `${context} TemplateElement[value.raw=${PHYSICAL_CLASS}]`,
              message: physicalClassMessage,
            },
          ]),
        ],
      },
    },
    {
      files: ['src/routes/**/*.tsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
  );
}
