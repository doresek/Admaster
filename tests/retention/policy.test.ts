// tests/retention/policy.test.ts — defaults + per-client override merge:
// a broken override must never disable a cap (falls back to the default).
import { describe, it, expect } from 'vitest';
import { DEFAULT_RETENTION_POLICY, resolvePolicy, parseHHMM } from '@/lib/retention/policy';

describe('DEFAULT_RETENTION_POLICY (the owner-question defaults)', () => {
  it('carries the authorized defaults', () => {
    expect(DEFAULT_RETENTION_POLICY).toMatchObject({
      dailyCapPerContact: 1,
      minGapDays: 3,
      weeklyCap: 2,
      monthlyCap: 6,
      promoDedupDays: 90,
      clientDailySendCap: 200,
      sendWindowStartMin: 540,   // 09:00
      sendWindowEndMin: 1230,    // 20:30
      shabbatStartMin: 900,      // Fri 15:00
      shabbatEndMin: 1260,       // Sat 21:00
    });
  });
});

describe('parseHHMM', () => {
  it('parses valid times', () => {
    expect(parseHHMM('09:00')).toBe(540);
    expect(parseHHMM('20:30')).toBe(1230);
    expect(parseHHMM('0:05')).toBe(5);
  });
  it('rejects garbage', () => {
    expect(parseHHMM('25:00')).toBeNull();
    expect(parseHHMM('09:60')).toBeNull();
    expect(parseHHMM('noon')).toBeNull();
    expect(parseHHMM(930)).toBeNull();
  });
});

describe('resolvePolicy (clients.retention_policy jsonb merge)', () => {
  it('non-object input → pure defaults', () => {
    expect(resolvePolicy(null)).toEqual(DEFAULT_RETENTION_POLICY);
    expect(resolvePolicy(undefined)).toEqual(DEFAULT_RETENTION_POLICY);
    expect(resolvePolicy('{}')).toEqual(DEFAULT_RETENTION_POLICY);
    expect(resolvePolicy([1, 2])).toEqual(DEFAULT_RETENTION_POLICY);
  });
  it('merges valid numeric caps', () => {
    const p = resolvePolicy({ daily_cap: 2, weekly_cap: 3, client_daily_send_cap: 50 });
    expect(p.dailyCapPerContact).toBe(2);
    expect(p.weeklyCap).toBe(3);
    expect(p.clientDailySendCap).toBe(50);
    expect(p.monthlyCap).toBe(6); // untouched default
  });
  it('accepts time overrides as "HH:MM" or minutes', () => {
    const p = resolvePolicy({ shabbat_start: '14:00', send_window_end: 1200 });
    expect(p.shabbatStartMin).toBe(840);
    expect(p.sendWindowEndMin).toBe(1200);
  });
  it('ignores invalid values field-by-field (fail toward the default)', () => {
    const p = resolvePolicy({
      daily_cap: -5,
      min_gap_days: 'lots',
      shabbat_start: '99:99',
      send_window_start: 2000, // ≥ 24h — invalid
    });
    expect(p.dailyCapPerContact).toBe(1);
    expect(p.minGapDays).toBe(3);
    expect(p.shabbatStartMin).toBe(900);
    expect(p.sendWindowStartMin).toBe(540);
  });
});
