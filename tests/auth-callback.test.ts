// Open-redirect guard for the auth callback: safeNextPath must only ever
// return a local absolute path, never an off-site target.
import { describe, it, expect } from 'vitest';
import { safeNextPath } from '@/lib/safe-next-path';
import { friendlyAuthError } from '@/lib/auth-messages';

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

  it('preserves the password-recovery target with a query', () => {
    expect(safeNextPath('/reset-password')).toBe('/reset-password');
    expect(safeNextPath('/reset-password?token=abc')).toBe('/reset-password?token=abc');
  });
});

// The callback redirects failures to /login?error=<code>; the login page must
// turn that code into a clear message rather than showing a blank bounce.
describe('friendlyAuthError', () => {
  it('explains a missing code', () => {
    expect(friendlyAuthError('missing_code')).toContain('קישור');
  });

  it('explains an expired/invalid PKCE code (any casing)', () => {
    expect(friendlyAuthError('Email link is invalid or has expired')).toContain('תוקף');
    expect(friendlyAuthError('CODE_VERIFIER_MISMATCH')).toContain('תוקף');
  });

  it('passes through an unrecognised message unchanged', () => {
    expect(friendlyAuthError('Something else')).toBe('Something else');
  });
});
