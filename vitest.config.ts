import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
  // The app tsconfig sets jsx:"preserve" (Next compiles JSX). Some tests import
  // .tsx components and render them to static markup, so the (rolldown-vite) oxc
  // transform must compile JSX with the React 18 automatic runtime.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
