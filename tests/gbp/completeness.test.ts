// tests/gbp/completeness.test.ts — P1-GBP-1 completeness engine (pure).
import { describe, expect, it } from 'vitest';
import {
  auditCompleteness,
  buildGbpDescription,
  coerceProfileState,
  emptyProfileState,
  gbpDeepLink,
  suggestServicesFromAtoms,
  GBP_DESCRIPTION_MAX,
  GBP_FIELD_WEIGHTS,
  type GbpProfileState,
} from '@/lib/gbp/completeness';
import type { ClientInsight } from '@/lib/intelligence/types';

// ── fixtures ──────────────────────────────────────────────────────────────────

let seq = 0;
function atom(kind: string, content: string, layer = 'business', confidence = 0.8): ClientInsight {
  seq += 1;
  return {
    id: `a${seq}`, client_id: 'c1', owner_user_id: 'u1',
    layer: layer as ClientInsight['layer'], kind, content,
    structured: null, source: 'brief', source_ref: null,
    confidence, evidence_count: 1, status: 'active',
    superseded_by: null, superseded_reason: null,
    first_seen_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  };
}

const ATOMS: ClientInsight[] = [
  atom('core_offer', 'טיפולי פיזיותרפיה מתקדמים'),
  atom('real_solution', 'שיקום כאבי גב בלי ניתוח'),
  atom('real_usp', 'מטפל בכיר עם 20 שנות ניסיון'),
  atom('true_value', 'חזרה לתפקוד מלא בתוך שבועות', 'business'),
  atom('pain_solved', 'כאבי גב כרוניים'),
];

/** A fully-complete profile state (relative to ATOMS) — should score 100. */
function fullState(): GbpProfileState {
  return {
    canonical_name: 'קליניקת שלם',
    gbp_name: 'קליניקת שלם',
    city: 'רעננה',
    primary_category: 'קליניקה לפיזיותרפיה',
    additional_categories: [],
    services: ['טיפולי פיזיותרפיה מתקדמים', 'שיקום כאבי גב בלי ניתוח'],
    description: 'א'.repeat(400),
    website: 'https://shalem.example.co.il',
    phone: '050-1234567',
    address: 'רחוב אחוזה 100, רעננה',
    hours: {
      sun: { closed: false, open: '09:00', close: '18:00' },
      mon: { closed: false, open: '09:00', close: '18:00' },
      tue: { closed: false, open: '09:00', close: '18:00' },
      wed: { closed: false, open: '09:00', close: '18:00' },
      thu: { closed: false, open: '09:00', close: '18:00' },
      fri: { closed: false, open: '09:00', close: '13:00' },
      sat: { closed: true },
    },
    holiday_hours_set: true,
    photos_last_30d: 5,
    attributes_count: 4,
    opening_date: '2015-03',
  };
}

// A date with a holiday inside the 60-day window (רה"ש 2026-09-11).
const NEAR_HOLIDAY = new Date('2026-08-15T10:00:00Z');
// A date with NO holiday within 60 days (2027-05-01 → past פסח 2027-04-01).
const NO_HOLIDAY = new Date('2027-05-01T10:00:00Z');

const item = (audit: ReturnType<typeof auditCompleteness>, field: string) => {
  const it = audit.items.find((i) => i.field === field);
  if (!it) throw new Error(`missing item ${field}`);
  return it;
};

// ── scoring ───────────────────────────────────────────────────────────────────

describe('auditCompleteness — scoring', () => {
  it('weights sum to exactly 100', () => {
    const sum = Object.values(GBP_FIELD_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('a fully complete profile scores 100', () => {
    const audit = auditCompleteness(fullState(), ATOMS, { now: NEAR_HOLIDAY });
    expect(audit.score).toBe(100);
    expect(audit.items.every((i) => i.status === 'ok')).toBe(true);
  });

  it('an empty profile scores near zero (holiday item may be ok when none upcoming)', () => {
    const audit = auditCompleteness(emptyProfileState(), [], { now: NO_HOLIDAY });
    // Only holiday_hours can be 'ok' (no upcoming chagim → nothing to set).
    expect(audit.score).toBe(GBP_FIELD_WEIGHTS.holiday_hours);
  });

  it('weak statuses earn half weight', () => {
    const s = fullState();
    s.photos_last_30d = 2; // weak (1-3)
    const audit = auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY });
    expect(audit.score).toBe(100 - GBP_FIELD_WEIGHTS.photos / 2);
  });
});

// ── per-factor status transitions ────────────────────────────────────────────

describe('auditCompleteness — per-factor transitions', () => {
  it('name: missing → weak (mismatch) → ok (exact after normalization)', () => {
    const s = fullState();
    s.gbp_name = '';
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'name').status).toBe('missing');

    s.gbp_name = 'קליניקת שלם — פיזיותרפיה מומלצת ברעננה'; // keyword stuffing
    const weak = item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'name');
    expect(weak.status).toBe('weak');
    expect(weak.prepared_value).toBe('קליניקת שלם'); // the canonical name to paste

    s.gbp_name = '  קליניקת  שלם '; // whitespace-only differences normalize away
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'name').status).toBe('ok');
  });

  it('category: generic categories are weak (narrowest-category rule)', () => {
    const s = fullState();
    s.primary_category = 'שירותים';
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'category').status).toBe('weak');
    s.primary_category = '';
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'category').status).toBe('missing');
  });

  it('services: uncovered atom-derived offers make the field weak, with prepared suggestions', () => {
    const s = fullState();
    s.services = ['טיפולי פיזיותרפיה מתקדמים']; // covers offer, not solution
    const it2 = item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'services');
    expect(it2.status).toBe('weak');
    expect(it2.prepared_value).toContain('שיקום כאבי גב בלי ניתוח');

    s.services = [];
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'services').status).toBe('missing');
  });

  it('description: missing / too-short (weak) / over-750 (weak) / ok', () => {
    const s = fullState();
    s.description = '';
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'description').status).toBe('missing');
    s.description = 'קצר מדי';
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'description').status).toBe('weak');
    s.description = 'א'.repeat(751);
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'description').status).toBe('weak');
    s.description = 'א'.repeat(300);
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'description').status).toBe('ok');
  });

  it('photos cadence: 0 missing, 1-3 weak, >=4 ok', () => {
    const s = fullState();
    s.photos_last_30d = 0;
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'photos').status).toBe('missing');
    s.photos_last_30d = 3;
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'photos').status).toBe('weak');
    s.photos_last_30d = 4;
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'photos').status).toBe('ok');
  });
});

// ── hours + chagim ────────────────────────────────────────────────────────────

describe('auditCompleteness — hours and chagim', () => {
  it('hours: no days = missing; a day without hours (esp. Friday) = weak; all 7 explicit = ok', () => {
    const s = fullState();
    s.hours = {};
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'hours').status).toBe('missing');

    s.hours = fullState().hours;
    delete s.hours.fri;
    const weak = item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'hours');
    expect(weak.status).toBe('weak');
    expect(weak.details_he).toContain('שישי');

    s.hours = fullState().hours; // sat explicitly closed counts as defined
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'hours').status).toBe('ok');
  });

  it('holiday hours: required only when a chag falls in the 60-day window', () => {
    const s = fullState();
    s.holiday_hours_set = false;

    // רה"ש 2026-09-11 is within 60 days of 2026-08-15 → missing + prepared list.
    const near = auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY });
    const hh = item(near, 'holiday_hours');
    expect(hh.status).toBe('missing');
    expect(hh.prepared_value).toContain('ראש השנה');
    expect(near.upcoming_holidays.map((h) => h.name)).toContain('ראש השנה');

    // No chag within 60 days → nothing to set → ok.
    expect(item(auditCompleteness(s, ATOMS, { now: NO_HOLIDAY }), 'holiday_hours').status).toBe('ok');

    // Set → ok even near a chag.
    s.holiday_hours_set = true;
    expect(item(auditCompleteness(s, ATOMS, { now: NEAR_HOLIDAY }), 'holiday_hours').status).toBe('ok');
  });
});

// ── description builder ───────────────────────────────────────────────────────

describe('buildGbpDescription', () => {
  it('stitches a Hebrew description from the atoms: <=750 chars, includes the offer terms + name + city', () => {
    const desc = buildGbpDescription({ canonical_name: 'קליניקת שלם', city: 'רעננה' }, ATOMS);
    expect(desc.length).toBeGreaterThan(0);
    expect(desc.length).toBeLessThanOrEqual(GBP_DESCRIPTION_MAX);
    expect(desc).toContain('קליניקת שלם');
    expect(desc).toContain('ברעננה');
    expect(desc).toContain('טיפולי פיזיותרפיה מתקדמים'); // core_offer terms
    expect(desc).toContain('שיקום כאבי גב בלי ניתוח');   // real_solution
    expect(desc).toContain('מטפל בכיר עם 20 שנות ניסיון'); // real_usp
  });

  it('never exceeds 750 chars even with very long atoms (sentence-boundary cut)', () => {
    const long = ATOMS.concat([atom('true_value', 'ט'.repeat(900))]);
    const desc = buildGbpDescription({ canonical_name: 'עסק', city: '' }, long);
    expect(desc.length).toBeLessThanOrEqual(GBP_DESCRIPTION_MAX);
  });

  it('hard-truncates when even the first sentence exceeds the cap', () => {
    const crazy = [atom('core_offer', 'א'.repeat(900))];
    const desc = buildGbpDescription({ canonical_name: 'עסק', city: '' }, crazy);
    expect(desc.length).toBeLessThanOrEqual(GBP_DESCRIPTION_MAX);
    expect(desc.endsWith('…')).toBe(true);
  });

  it('empty canonical name → empty description; no atoms → still a valid minimal description', () => {
    expect(buildGbpDescription({ canonical_name: '', city: 'חיפה' }, ATOMS)).toBe('');
    const noAtoms = buildGbpDescription({ canonical_name: 'עסק', city: '' }, []);
    expect(noAtoms).toContain('עסק');
    expect(noAtoms.length).toBeLessThanOrEqual(GBP_DESCRIPTION_MAX);
  });

  it('ignores superseded atoms', () => {
    const dead = { ...atom('core_offer', 'הצעה ישנה שנפסלה'), status: 'superseded' as const };
    const desc = buildGbpDescription({ canonical_name: 'עסק', city: '' }, [dead]);
    expect(desc).not.toContain('הצעה ישנה');
  });
});

// ── services suggestions ──────────────────────────────────────────────────────

describe('suggestServicesFromAtoms', () => {
  it('derives distinct suggestions from core_offer + real_solution only', () => {
    const sugg = suggestServicesFromAtoms(ATOMS);
    expect(sugg).toContain('טיפולי פיזיותרפיה מתקדמים');
    expect(sugg).toContain('שיקום כאבי גב בלי ניתוח');
    expect(sugg).not.toContain('מטפל בכיר עם 20 שנות ניסיון'); // usp is not a service
  });

  it('dedupes case/whitespace variants', () => {
    const dup = [atom('core_offer', ' טיפול  A '), atom('real_solution', 'טיפול a')];
    expect(suggestServicesFromAtoms(dup)).toHaveLength(1);
  });
});

// ── deep links ────────────────────────────────────────────────────────────────

describe('gbpDeepLink', () => {
  it('routes photos and services to their sections, everything else to /info', () => {
    expect(gbpDeepLink('photos')).toBe('https://business.google.com/photos');
    expect(gbpDeepLink('services')).toBe('https://business.google.com/services');
    expect(gbpDeepLink('name')).toBe('https://business.google.com/info');
    expect(gbpDeepLink('hours')).toBe('https://business.google.com/info');
    expect(gbpDeepLink('holiday_hours')).toBe('https://business.google.com/info');
  });

  it('every audit item carries a deep link', () => {
    const audit = auditCompleteness(emptyProfileState(), [], { now: NEAR_HOLIDAY });
    for (const it2 of audit.items) {
      expect(it2.deep_link).toMatch(/^https:\/\/business\.google\.com\//);
    }
  });
});

// ── coercion (API boundary) ───────────────────────────────────────────────────

describe('coerceProfileState', () => {
  it('coerces garbage safely to an empty state', () => {
    expect(coerceProfileState(null)).toEqual(emptyProfileState());
    expect(coerceProfileState('nope')).toEqual(emptyProfileState());
    expect(coerceProfileState({ photos_last_30d: 'many', hours: 7 })).toEqual(emptyProfileState());
  });

  it('keeps valid fields, drops malformed hours, clamps numbers', () => {
    const out = coerceProfileState({
      canonical_name: '  עסק  ',
      services: ['א', '', 42, 'ב'],
      photos_last_30d: -3,
      attributes_count: 5000,
      hours: { sun: { closed: true }, mon: { open: '9am', close: '18:00' }, tue: { open: '09:00', close: '18:00' } },
      holiday_hours_set: 'yes',
    });
    expect(out.canonical_name).toBe('עסק');
    expect(out.services).toEqual(['א', 'ב']);
    expect(out.photos_last_30d).toBe(0);
    expect(out.attributes_count).toBe(999);
    expect(out.hours.sun).toEqual({ closed: true });
    expect(out.hours.mon).toBeUndefined(); // '9am' is not HH:MM
    expect(out.hours.tue).toEqual({ closed: false, open: '09:00', close: '18:00' });
    expect(out.holiday_hours_set).toBe(false); // only literal true passes
  });
});
