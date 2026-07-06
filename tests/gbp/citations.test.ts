// tests/gbp/citations.test.ts — P1-GBP-4 NAP/citations sync checklist (pure).
import { describe, expect, it } from 'vitest';
import {
  checkNapConsistency,
  directoryById,
  normalizeAddress,
  normalizeNapText,
  normalizePhoneIL,
  IL_DIRECTORIES,
  type CanonicalNap,
  type NapListing,
} from '@/lib/gbp/citations';

const CANON: CanonicalNap = {
  name: 'קליניקת שלם',
  address: 'רחוב אחוזה 100, רעננה',
  phone: '050-1234567',
  website: 'https://shalem.example.co.il',
};

// ── phone normalization (05x formats → E.164) ─────────────────────────────────

describe('normalizePhoneIL', () => {
  it('normalizes the common Israeli mobile formats to +972', () => {
    expect(normalizePhoneIL('050-1234567')).toBe('+972501234567');
    expect(normalizePhoneIL('050 123 4567')).toBe('+972501234567');
    expect(normalizePhoneIL('0501234567')).toBe('+972501234567');
    expect(normalizePhoneIL('(050) 123-4567')).toBe('+972501234567');
    expect(normalizePhoneIL('+972-50-123-4567')).toBe('+972501234567');
    expect(normalizePhoneIL('972501234567')).toBe('+972501234567');
    expect(normalizePhoneIL('+9720501234567')).toBe('+972501234567'); // sloppy +9720 form
  });

  it('normalizes landlines (0x-xxxxxxx, 8-digit national numbers)', () => {
    expect(normalizePhoneIL('02-6231234')).toBe('+97226231234');
    expect(normalizePhoneIL('03 555 1234')).toBe('+97235551234');
    expect(normalizePhoneIL('09-7654321')).toBe('+97297654321');
  });

  it('rejects star numbers, short codes and garbage (flag, never silently pass)', () => {
    expect(normalizePhoneIL('*2244')).toBeNull();
    expect(normalizePhoneIL('106')).toBeNull();
    expect(normalizePhoneIL('')).toBeNull();
    expect(normalizePhoneIL('phone me')).toBeNull();
    expect(normalizePhoneIL('501234567')).toBeNull();   // no leading 0, no CC — ambiguous
    expect(normalizePhoneIL('050-12345678')).toBeNull(); // too many digits for a mobile
    expect(normalizePhoneIL('0212345678')).toBeNull();   // 9-digit national must start 5/7
  });
});

// ── text/address normalization ────────────────────────────────────────────────

describe('normalizeNapText / normalizeAddress', () => {
  it('unifies gershayim/quotes, dashes and whitespace; lowercases latin', () => {
    expect(normalizeNapText('שלם בע״מ')).toBe(normalizeNapText('שלם בע"מ'));
    expect(normalizeNapText('Cafe–Shalem')).toBe('cafe-shalem');
    expect(normalizeNapText('  שלם   קליניקה ')).toBe('שלם קליניקה');
  });

  it("unifies רח' ↔ רחוב and שד' ↔ שדרות in addresses", () => {
    expect(normalizeAddress("רח' אחוזה 100, רעננה")).toBe(normalizeAddress('רחוב אחוזה 100 רעננה'));
    expect(normalizeAddress("שד' רוטשילד 1")).toBe(normalizeAddress('שדרות רוטשילד 1'));
  });
});

// ── deviation detection ───────────────────────────────────────────────────────

function listing(directory: NapListing['directory'], over: Partial<NapListing> = {}): NapListing {
  return {
    directory, listed: true,
    name: CANON.name, address: CANON.address, phone: CANON.phone,
    ...over,
  };
}

describe('checkNapConsistency', () => {
  it('all directories matching → consistent, zero issues', () => {
    const listings = IL_DIRECTORIES.map((d) => listing(d.id));
    const report = checkNapConsistency(CANON, listings);
    expect(report.consistent).toBe(true);
    expect(report.issues_count).toBe(0);
    expect(report.canonical_phone_e164).toBe('+972501234567');
    expect(report.results.every((r) => r.status === 'match')).toBe(true);
  });

  it('equivalent-but-differently-formatted values are NOT deviations', () => {
    const report = checkNapConsistency(CANON, [
      listing('zap', {
        phone: '+972 50 123 4567',            // same number, E.164-ish format
        address: "רח' אחוזה 100 רעננה",       // רח' vs רחוב, no comma
        name: 'קליניקת  שלם',                  // extra space
      }),
    ]);
    expect(report.results[0].status).toBe('match');
  });

  it('flags ANY real deviation with expected vs found', () => {
    const report = checkNapConsistency(CANON, [
      listing('d_co_il', { phone: '050-7654321' }),          // old phone
      listing('easy', { name: 'שלם קליניקה לפיזיותרפיה' }),  // different name
      listing('midrag', { address: 'רחוב אחוזה 102, רעננה' }), // wrong number
    ]);
    expect(report.consistent).toBe(false);
    expect(report.issues_count).toBe(3);

    const byDir = Object.fromEntries(report.results.map((r) => [r.directory, r]));
    expect(byDir.d_co_il.status).toBe('deviation');
    expect(byDir.d_co_il.deviations[0]).toMatchObject({
      field: 'phone', expected: '050-1234567', found: '050-7654321',
    });
    expect(byDir.easy.deviations[0].field).toBe('name');
    expect(byDir.midrag.deviations[0].field).toBe('address');
  });

  it('an unparseable listed phone is compared as raw text (deviation when different)', () => {
    const report = checkNapConsistency(CANON, [listing('waze', { phone: '*2244' })]);
    expect(report.results[0].status).toBe('deviation');
    expect(report.results[0].deviations[0].field).toBe('phone');
  });

  it('not listed → missing (a placement task); listed with no data → unknown', () => {
    const report = checkNapConsistency(CANON, [
      { directory: 'zap', listed: false },
      { directory: 'easy', listed: true, name: '', address: '', phone: '' },
    ]);
    const byDir = Object.fromEntries(report.results.map((r) => [r.directory, r]));
    expect(byDir.zap.status).toBe('missing');
    expect(byDir.easy.status).toBe('unknown');
    expect(report.consistent).toBe(false); // unknown blocks a "consistent" verdict
    expect(report.issues_count).toBe(1);   // only the missing listing counts as an issue
  });

  it('empty/omitted fields on a listing are skipped, not flagged', () => {
    const report = checkNapConsistency(CANON, [
      { directory: 'waze', listed: true, name: CANON.name }, // no address/phone entered
    ]);
    expect(report.results[0].status).toBe('match');
    expect(report.results[0].deviations).toHaveLength(0);
  });
});

// ── directory set + deep links ────────────────────────────────────────────────

describe('IL directory set + deep links', () => {
  it('covers the Israeli citation set from the research doc', () => {
    const ids = IL_DIRECTORIES.map((d) => d.id);
    expect(ids).toEqual(['site_jsonld', 'd_co_il', 'zap', 'easy', 'midrag', 'waze']);
  });

  it('builds encoded search deep links per directory', () => {
    expect(directoryById('d_co_il')!.deepLink('קליניקת שלם'))
      .toBe(`https://www.d.co.il/search/?q=${encodeURIComponent('קליניקת שלם')}`);
    expect(directoryById('zap')!.deepLink('שלם')).toContain('zap.co.il');
    expect(directoryById('easy')!.deepLink('שלם')).toContain('easy.co.il');
    expect(directoryById('midrag')!.deepLink('שלם')).toContain('midrag.co.il');
    expect(directoryById('waze')!.deepLink('שלם')).toContain('waze.com');
  });

  it('site_jsonld deep link is the client website (empty when none)', () => {
    const d = directoryById('site_jsonld')!;
    expect(d.deepLink('שלם', 'https://x.co.il')).toBe('https://x.co.il');
    expect(d.deepLink('שלם')).toBe('');
  });

  it('checkNapConsistency results carry the deep links', () => {
    const report = checkNapConsistency(CANON, [{ directory: 'd_co_il', listed: false }]);
    expect(report.results[0].deep_link).toContain('d.co.il');
  });
});
