import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.spec.{ts,tsx}'],
      setupFiles: ['./src/vitest.setup.ts'],
      // Above the 5 s async waits (`vitest.setup.ts`), so a slow wait fails as itself.
      testTimeout: 15_000,
    },
  }),
);
