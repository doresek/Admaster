// tests/anti-abuse/phone.test.ts — phone normalization (feeds the unique index).
import { describe, it, expect } from 'vitest';
import { normalizePhone, isValidPhone } from '@/lib/anti-abuse/phone';

describe('normalizePhone', () => {
  it('collapses IL formatting variants to one canonical E.164', () => {
    const canonical = '+972501234567';
    expect(normalizePhone('050-123 4567')).toBe(canonical);
    expect(normalizePhone('0501234567')).toBe(canonical);
    expect(normalizePhone('+972501234567')).toBe(canonical);
    expect(normalizePhone('972501234567')).toBe(canonical);
  });

  it('rejects junk / too-short input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('isValidPhone mirrors normalizePhone', () => {
    expect(isValidPhone('0501234567')).toBe(true);
    expect(isValidPhone('nope')).toBe(false);
  });
});
