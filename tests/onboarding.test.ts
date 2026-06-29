import { describe, it, expect } from 'vitest';
import { isNewUser } from '@/lib/onboarding';

describe('isNewUser', () => {
  it('treats a user with zero clients as new', () => {
    expect(isNewUser(0)).toBe(true);
  });

  it('treats null/undefined client count as new (no rows yet)', () => {
    expect(isNewUser(null)).toBe(true);
    expect(isNewUser(undefined)).toBe(true);
  });

  it('treats a user with one or more clients as established', () => {
    expect(isNewUser(1)).toBe(false);
    expect(isNewUser(5)).toBe(false);
  });

  it('never treats negative counts as established (defensive)', () => {
    expect(isNewUser(-1)).toBe(true);
  });
});
