const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');

module.exports = defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5183,
    strictPort: true
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('react-dom')
            || id.includes('react-is')
            || id.includes('scheduler')
            || id.includes('use-sync-external-store')
            || /node_modules[/\\]react[/\\]/.test(id)
          ) return 'react-vendor';
          if (id.includes('@radix-ui')) return 'radix-vendor';
          if (id.includes('lucide-react')) return 'icon-vendor';
          if (id.includes('i18next')) return 'i18n-vendor';
          if (id.includes('recharts') || id.includes('d3-')) return 'chart-vendor';
          return undefined;
        }
      }
    }
  },
  clearScreen: false
});
