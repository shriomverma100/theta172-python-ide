import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Use relative paths in build so Electron can load via file://
  base: command === 'build' ? './' : '/',

  server: {
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  preview: {
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xterm/xterm') || id.includes('@xterm/addon-fit')) {
            return 'xterm';
          }
          if (id.includes('@codemirror') || id.includes('codemirror') || id.includes('@lezer')) {
            return 'codemirror';
          }
        },
      },
    },
  },

  // Workers ship as single classic scripts so they load from file://
  worker: {
    format: 'iife',
  },

  optimizeDeps: {
    exclude: ['@xterm/xterm', '@xterm/addon-fit'],
  },
}));
