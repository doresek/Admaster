// tests/retention/contacts.test.ts — the pure import machinery behind
// POST /api/retention/contacts: consent-required normalization, the tiny CSV
// parser, and planImport's dedup + THE TOMBSTONE RULE (an opted-out contact
// is never resurrected by a re-import).
import { describe, it, expect } from 'vitest';
import {
  normalizeContactInput,
  normalizePhone,
  normalizeEmail,
  parseCsv,
  planImport,
  type ExistingContactKey,
} from '@/lib/retention/contacts';

const VALID = {
  full_name: 'דנה כהן',
  phone: '050-123 4567',
  email: 'Dana@Example.com',
  tags: 'vip;newsletter',
  consent_source: 'import',
  consented_at: '2026-05-01T10:00:00Z',
  consent_evidence: 'רשימת לקוחות מאושרת, נאספה בדלפק',
};

describe('normalizePhone / normalizeEmail', () => {
  it('strips separators and validates length', () => {
    expect(normalizePhone('050-123 4567')).toBe('0501234567');
    expect(normalizePhone('+972 50 123 4567')).toBe('+972501234567');
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('12')).toBeNull();
  });
  it('lowercases emails at write time (052 contract)', () => {
    expect(normalizeEmail('Dana@Example.COM')).toBe('dana@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
  });
});

describe('normalizeContactInput — consent is STRUCTURAL', () => {
  it('accepts a fully-attested row and normalizes it', () => {
    const r = normalizeContactInput(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contact).toMatchObject({
        full_name: 'דנה כהן',
        phone: '0501234567',
        email: 'dana@example.com',
        tags: ['vip', 'newsletter'],
        consent_source: 'import',
        consented_at: '2026-05-01T10:00:00.000Z',
      });
    }
  });
  it('rejects a row without consent_source', () => {
    const { consent_source: _x, ...row } = VALID;
    const r = normalizeContactInput(row);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('consent_source') });
  });
  it('rejects a row without consented_at', () => {
    const { consented_at: _x, ...row } = VALID;
    const r = normalizeContactInput(row);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('consented_at') });
  });
  it('rejects an unknown consent_source and an unparsable consented_at', () => {
    expect(normalizeContactInput({ ...VALID, consent_source: 'vibes' }).ok).toBe(false);
    expect(normalizeContactInput({ ...VALID, consented_at: 'sometime' }).ok).toBe(false);
  });
  it('rejects a contact reachable on no channel', () => {
    const r = normalizeContactInput({ ...VALID, phone: '', email: '' });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('phone or email') });
  });
  it('merges bulk-attestation defaults UNDER the row (row wins)', () => {
    const { consent_source: _s, consented_at: _t, ...bare } = VALID;
    const r = normalizeContactInput(bare, {
      consent_source: 'import',
      consented_at: '2026-06-01T00:00:00Z',
      consent_evidence: 'attestation: כל הרשימה opt-in',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contact.consent_source).toBe('import');
    const r2 = normalizeContactInput(
      { ...bare, consent_source: 'manual', consented_at: '2026-04-01T00:00:00Z' },
      { consent_source: 'import', consented_at: '2026-06-01T00:00:00Z' },
    );
    if (r2.ok) expect(r2.contact.consent_source).toBe('manual');
  });
  it('still rejects when neither row nor defaults carry consent', () => {
    const { consent_source: _s, consented_at: _t, ...bare } = VALID;
    expect(normalizeContactInput(bare, {}).ok).toBe(false);
  });
});

describe('parseCsv', () => {
  it('parses headers, quoted cells with commas, and CRLF', () => {
    const csv = 'full_name,phone,email\r\n"כהן, דנה",0501234567,dana@x.com\r\nיוסי,,yossi@x.com\r\n';
    expect(parseCsv(csv)).toEqual([
      { full_name: 'כהן, דנה', phone: '0501234567', email: 'dana@x.com' },
      { full_name: 'יוסי', phone: '', email: 'yossi@x.com' },
    ]);
  });
  it('handles escaped quotes and skips blank lines', () => {
    const csv = 'full_name,note\n"דנה ""המלכה""",hi\n\n';
    expect(parseCsv(csv)).toEqual([{ full_name: 'דנה "המלכה"', note: 'hi' }]);
  });
  it('returns [] for header-only or empty input', () => {
    expect(parseCsv('full_name,phone\n')).toEqual([]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('planImport — dedup + the tombstone rule', () => {
  const existing: ExistingContactKey[] = [
    { id: 'live-1', phone: '0501111111', email: 'live@x.com', opted_out_at: null },
    { id: 'dead-1', phone: '0502222222', email: 'dead@x.com', opted_out_at: '2026-03-01T00:00:00Z' },
  ];
  const row = (over: Record<string, unknown>) => ({
    consent_source: 'import',
    consented_at: '2026-05-01T00:00:00Z',
    ...over,
  });

  it('THE TOMBSTONE: an opted-out phone/email is skipped, never resurrected', () => {
    const byPhone = planImport([row({ phone: '050-222 2222' })], existing);
    expect(byPhone[0]).toMatchObject({ action: 'skipped_opted_out', existingId: 'dead-1' });
    const byEmail = planImport([row({ email: 'DEAD@x.com' })], existing);
    expect(byEmail[0]).toMatchObject({ action: 'skipped_opted_out', existingId: 'dead-1' });
  });
  it('a live duplicate is skipped (no silent update)', () => {
    const r = planImport([row({ phone: '0501111111' })], existing);
    expect(r[0]).toMatchObject({ action: 'skipped_duplicate', existingId: 'live-1' });
  });
  it('a new attested contact is planned for insert', () => {
    const r = planImport([row({ phone: '0503333333', full_name: 'חדשה' })], existing);
    expect(r[0].action).toBe('insert');
  });
  it('rows without consent attestation are rejected per-row', () => {
    const r = planImport([{ phone: '0504444444' }], existing);
    expect(r[0]).toMatchObject({ action: 'rejected', error: expect.stringContaining('consent_source') });
  });
  it('bulk defaults rescue attestation-less rows; tombstone still wins', () => {
    const defaults = { consent_source: 'import', consented_at: '2026-05-01T00:00:00Z' };
    const r = planImport(
      [{ phone: '0505555555' }, { phone: '0502222222' }],
      existing,
      defaults,
    );
    expect(r[0].action).toBe('insert');
    expect(r[1]).toMatchObject({ action: 'skipped_opted_out', existingId: 'dead-1' });
  });
  it('in-batch duplicates: first wins, rest skipped', () => {
    const r = planImport(
      [row({ phone: '0506666666' }), row({ phone: '0506666666', full_name: 'כפולה' })],
      [],
    );
    expect(r[0].action).toBe('insert');
    expect(r[1].action).toBe('skipped_duplicate');
  });
  it('mixed batch reports per-row results with stable indexes', () => {
    const r = planImport(
      [row({ phone: '0507777777' }), { phone: 'bad' }, row({ email: 'dead@x.com' })],
      existing,
    );
    expect(r.map((x) => x.action)).toEqual(['insert', 'rejected', 'skipped_opted_out']);
    expect(r.map((x) => x.index)).toEqual([0, 1, 2]);
  });
});
