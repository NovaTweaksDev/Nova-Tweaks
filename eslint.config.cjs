const hooks = require('eslint-plugin-react-hooks');
const globals = Object.fromEntries([
  'queueMicrotask', 'global', 'AbortSignal', 'Response', 'structuredClone', 'HTMLElement',
  'console', 'process', 'Buffer', '__dirname', '__filename', 'module', 'require', 'exports',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'URL', 'URLSearchParams', 'fetch', 'AbortController', 'TextEncoder', 'TextDecoder',
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'performance',
  'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver',
  'CustomEvent', 'Event', 'Blob', 'FileReader', 'Image', 'MutationObserver', 'atob', 'btoa', 'crypto'
].map((name) => [name, 'readonly']));
module.exports = [
  { linterOptions: { reportUnusedDisableDirectives: false }, ignores: ['node_modules/**', 'dist*/**', 'resources/**', 'tools/**', 'electron/generated/**', '.nova-local-admin/**'] },
  { files: ['electron/**/*.js', 'scripts/**/*.js', 'src/**/*.{js,jsx,mjs}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error' } },
  { files: ['src/**/*.{js,jsx,mjs}'], plugins: { 'react-hooks': hooks }, rules: { 'react-hooks/rules-of-hooks': 'error' } }
];
