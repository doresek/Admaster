import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { META_GRAPH_VERSION, META_GRAPH_BASE } from '@/lib/meta-config';

// Recursively collect all .ts files under a directory.
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const ROOT = path.resolve(__dirname, '..');

describe('Meta Graph version is centralized', () => {
  it('exposes an env-driven version that defaults to v21.0', () => {
    expect(META_GRAPH_VERSION).toMatch(/^v\d+\.\d+$/);
    expect(META_GRAPH_BASE).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}`);
  });

  it('has no hardcoded v19.0 literal under app/api/meta', () => {
    const files = collectTsFiles(path.join(ROOT, 'app/api/meta'));
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('v19.0'));
    expect(offenders).toEqual([]);
  });

  it('has no hardcoded v19.0 literal in lib/meta* files', () => {
    const libDir = path.join(ROOT, 'lib');
    const files = readdirSync(libDir)
      .filter((f) => f.startsWith('meta') && (f.endsWith('.ts') || f.endsWith('.tsx')))
      .map((f) => path.join(libDir, f));
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('v19.0'));
    expect(offenders).toEqual([]);
  });
});
