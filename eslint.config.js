import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', 'tmp/**', 'build-assets/**'],
  },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Sanitizers and ANSI-stripping regexes match control characters on purpose
      'no-control-regex': 'off',
    },
  },
  // Renderer (browser, ES modules)
  {
    files: ['src/**/*.js', 'vite.config.js', 'vitest.config.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
  },
  // Pyodide web worker (classic worker script)
  {
    files: ['src/workers/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.worker, loadPyodide: 'readonly' },
    },
  },
  // Electron main process, scripts and the relay server (Node, CommonJS)
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.cjs', 'relay-server/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  // Tests
  {
    files: ['tests/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
];
