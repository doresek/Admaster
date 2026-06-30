// Local vitest config for the meta-ads module.
//
// The repo's root vitest.config.ts only discovers `tests/**/*.test.ts`, while
// this module's tests live alongside the code in `lib/meta-ads/__tests__/`
// (per the T3 brief: tests inside the owning folder, NOT shared tests/).
// Run them with:  npx vitest run --config lib/meta-ads/vitest.config.ts
//
// INTEGRATION FLAG: to fold these into the repo's single `npm test`, the root
// config should add `lib/**/__tests__/*.test.ts` to its `include` array (or a
// vitest workspace). That edit is outside this module's ownership and is left
// to the orchestrator.
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/meta-ads/__tests__/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '..', '..') },
  },
});
