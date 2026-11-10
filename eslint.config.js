import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', 'tmp/**', 'build-assets/**', 'vendor/**'],
  },
  // public/: plain browser scripts copied as-is (theme-init.js)
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
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
  // Example plugins: plain scripts that get the plugin API as `theta` (and may await at the top)
  {
    files: ['examples/plugins/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { theta: 'readonly' } },
  },
  // Tests
  {
    files: ['tests/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
];
