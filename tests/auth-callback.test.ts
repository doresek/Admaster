// Open-redirect guard for the auth callback: safeNextPath must only ever
// return a local absolute path, never an off-site target.
import { describe, it, expect } from 'vitest';
import { safeNextPath } from '@/lib/safe-next-path';

describe('safeNextPath', () => {
  it('falls back to / for null', () => {
    expect(safeNextPath(null)).toBe('/');
  });

  it('preserves a legitimate internal path', () => {
    expect(safeNextPath('/reset-password')).toBe('/reset-password');
  });

  it('preserves a path with sub-segments and query string', () => {
    expect(safeNextPath('/a/b?x=1')).toBe('/a/b?x=1');
  });

  it('rejects an absolute URL with a scheme', () => {
    expect(safeNextPath('https://evil.com')).toBe('/');
  });

  it('rejects a protocol-relative URL', () => {
    expect(safeNextPath('//evil.com')).toBe('/');
  });

  it('rejects a backslash protocol-relative trick', () => {
    expect(safeNextPath('/\\evil.com')).toBe('/');
  });
});
