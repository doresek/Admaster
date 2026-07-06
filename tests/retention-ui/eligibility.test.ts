// tests/retention-ui/eligibility.test.ts
//
// Pure audience-eligibility helpers (CP-6b T5) — the ONE definition shared by
// the enroll route and the series-page preview. The critical invariants:
// tombstone excludes ALWAYS, missing consent excludes ALWAYS, '{}' audience =
// everyone, tag match is any-overlap (SQL && semantics).

import { describe, it, expect } from 'vitest';
import {
  matchesAudience,
  isEligibleForEnrollment,
  countEligible,
  deriveTagSet,
  parseTagsInput,
  type AudienceContact,
} from '@/app/api/retention/enroll/eligibility';

const contact = (over: Partial<AudienceContact> = {}): AudienceContact => ({
  tags: [],
  consented_at: '2026-01-01T00:00:00.000Z',
  opted_out_at: null,
  ...over,
});

describe('matchesAudience', () => {
  it('empty audience matches everyone, even tagless contacts', () => {
    expect(matchesAudience([], [])).toBe(true);
    expect(matchesAudience(null, [])).toBe(true);
    expect(matchesAudience(['vip'], [])).toBe(true);
  });

  it('non-empty audience requires ANY overlap', () => {
    expect(matchesAudience(['vip', 'ניוזלטר'], ['vip'])).toBe(true);
    expect(matchesAudience(['ניוזלטר'], ['vip', 'ניוזלטר'])).toBe(true);
    expect(matchesAudience(['אחר'], ['vip'])).toBe(false);
  });

  it('tagless contact never matches a tagged audience', () => {
    expect(matchesAudience([], ['vip'])).toBe(false);
    expect(matchesAudience(null, ['vip'])).toBe(false);
  });
});

describe('isEligibleForEnrollment', () => {
  it('eligible: consented, no tombstone, in audience', () => {
    expect(isEligibleForEnrollment(contact({ tags: ['vip'] }), ['vip'])).toBe(true);
    expect(isEligibleForEnrollment(contact(), [])).toBe(true);
  });

  it('the tombstone excludes, regardless of tags/audience', () => {
    const dead = contact({ tags: ['vip'], opted_out_at: '2026-02-01T00:00:00.000Z' });
    expect(isEligibleForEnrollment(dead, ['vip'])).toBe(false);
    expect(isEligibleForEnrollment(dead, [])).toBe(false);
  });

  it('missing consent excludes (belt-and-braces over the NOT NULL column)', () => {
    expect(isEligibleForEnrollment(contact({ consented_at: null }), [])).toBe(false);
  });

  it('out-of-audience excludes', () => {
    expect(isEligibleForEnrollment(contact({ tags: ['אחר'] }), ['vip'])).toBe(false);
  });
});

describe('countEligible (the "ישלח ל-N" preview)', () => {
  const list: AudienceContact[] = [
    contact({ tags: ['vip'] }),
    contact({ tags: ['ניוזלטר'] }),
    contact({ tags: ['vip'], opted_out_at: '2026-03-01T00:00:00.000Z' }),  // tombstone
    contact({ tags: [] }),
    contact({ tags: ['vip'], consented_at: null }),                        // no consent
  ];

  it('empty audience counts all live consented contacts', () => {
    expect(countEligible(list, [])).toBe(3);
  });

  it('tagged audience counts only overlapping live consented contacts', () => {
    expect(countEligible(list, ['vip'])).toBe(1);
    expect(countEligible(list, ['vip', 'ניוזלטר'])).toBe(2);
    expect(countEligible(list, ['לא-קיים'])).toBe(0);
  });
});

describe('deriveTagSet', () => {
  it('unique, trimmed, sorted; skips empties and null tag arrays', () => {
    const tags = deriveTagSet([
      { tags: ['vip', ' ניוזלטר '] },
      { tags: ['vip', ''] },
      { tags: null },
      { tags: ['אירוע'] },
    ]);
    expect(tags).toHaveLength(3);
    expect(new Set(tags)).toEqual(new Set(['vip', 'ניוזלטר', 'אירוע']));
  });

  it('empty input → empty universe', () => {
    expect(deriveTagSet([])).toEqual([]);
  });
});

describe('parseTagsInput', () => {
  it('splits on , ; | and trims + dedups', () => {
    expect(parseTagsInput('vip, ניוזלטר ;vip| אירוע ')).toEqual(['vip', 'ניוזלטר', 'אירוע']);
  });

  it('empty / whitespace-only → []', () => {
    expect(parseTagsInput('')).toEqual([]);
    expect(parseTagsInput(' , ; ')).toEqual([]);
  });
});
