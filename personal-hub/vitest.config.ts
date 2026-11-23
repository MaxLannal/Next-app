import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts', 'scripts/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['web/src/**/*.test.{ts,tsx}', 'web/*.test.ts'],
          setupFiles: ['web/src/test/setup.ts'],
        },
      },
    ],
  },
});
