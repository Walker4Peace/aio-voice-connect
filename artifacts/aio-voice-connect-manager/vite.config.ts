import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

export default defineConfig(async ({ command }) => {
  // PORT and BASE_PATH are only required at runtime (dev server / preview).
  // During `vite build` they are not needed — the server block is ignored and
  // BASE_PATH defaults to '/' which is correct for the nginx-served production
  // build.
  const isBuild = command === 'build';

  const rawPort = process.env.PORT;
  const rawBasePath = process.env.BASE_PATH;

  if (!isBuild) {
    if (!rawPort) {
      throw new Error(
        'PORT environment variable is required but was not provided.',
      );
    }
    if (!rawBasePath) {
      throw new Error(
        'BASE_PATH environment variable is required but was not provided.',
      );
    }
  }

  const port = rawPort ? Number(rawPort) : 3000;
  const basePath = rawBasePath ?? '/';

  if (!isBuild && (Number.isNaN(port) || port <= 0)) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== 'production' &&
      process.env.REPL_ID !== undefined
        ? [
            await import('@replit/vite-plugin-cartographer').then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, '..'),
              }),
            ),
            await import('@replit/vite-plugin-dev-banner').then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
      // Proxy /api requests to the API server so session cookies stay same-origin
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: false,
        },
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
