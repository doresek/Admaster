import { describe, it, expect } from 'vitest';
import { creditAfterTopup, parseTopupCredits, hasActiveCustomer } from '@/lib/billing';

describe('creditAfterTopup', () => {
  it('adds purchased credits to the current balance', () => {
    expect(creditAfterTopup(150, 300)).toBe(450);
  });
  it('handles a zero starting balance', () => {
    expect(creditAfterTopup(0, 800)).toBe(800);
  });
  it('treats non-finite inputs as zero (no NaN balances)', () => {
    expect(creditAfterTopup(NaN as unknown as number, 100)).toBe(100);
    expect(creditAfterTopup(100, undefined as unknown as number)).toBe(100);
  });
});

describe('parseTopupCredits', () => {
  it('parses a valid metadata string', () => {
    expect(parseTopupCredits('300')).toBe(300);
  });
  it('returns 0 for invalid / missing values', () => {
    expect(parseTopupCredits(undefined)).toBe(0);
    expect(parseTopupCredits('0')).toBe(0);
    expect(parseTopupCredits('-5')).toBe(0);
    expect(parseTopupCredits('abc')).toBe(0);
  });
});

describe('hasActiveCustomer (portal no-customer guard)', () => {
  it('is false when Stripe returns no customers', () => {
    expect(hasActiveCustomer({ data: [] })).toBe(false);
    expect(hasActiveCustomer(null)).toBe(false);
    expect(hasActiveCustomer(undefined)).toBe(false);
  });
  it('is true when at least one customer matches the email', () => {
    expect(hasActiveCustomer({ data: [{ id: 'cus_123' }] })).toBe(true);
  });
});
