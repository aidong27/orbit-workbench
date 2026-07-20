import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';
import { injectContentSecurityPolicy } from './src/main/security';

function rendererCspPlugin(): Plugin {
  return {
    name: 'orbit-renderer-csp',
    enforce: 'pre',
    transformIndexHtml(html, context) {
      return injectContentSecurityPolicy(html, context.server === undefined);
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [rendererCspPlugin(), react()],
  },
});
