// lib/decision-engine/vitest.config.ts
//
// LOCAL test config for the Decision Engine. The repo-root vitest.config.ts only
// collects `tests/**`, and this module owns its tests in-folder, so this config
// lets the engine's tests run in isolation:
//
//   npx vitest run --config lib/decision-engine/vitest.config.ts
//
// (To fold these into the root `npm test`, add
//  'lib/**/__tests__/**/*.test.ts' to the include array in vitest.config.ts.)
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/decision-engine/__tests__/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '../..') },
  },
});
