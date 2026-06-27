import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Guard rails from CLAUDE.md: avoid `any`, keep files small, hooks correct.
// (import/no-cycle to be added once the TS import resolver is wired.)
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src/styles/**', '*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  }
);
