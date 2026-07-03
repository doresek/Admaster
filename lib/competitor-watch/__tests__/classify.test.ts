// Longevity classification (skill §2) — exact boundary behavior.
//
// NOW is pinned to 2026-07-01T00:00:00Z so every age is an exact whole-day
// count: veteran flips at EXACTLY 56 days (2026-05-06), churn at EXACTLY a
// 28-day lifespan, fresh below 14 days.

import { describe, expect, it } from 'vitest';
import {
  CHURN_MAX_LIFESPAN_DAYS,
  FRESH_MAX_AGE_DAYS,
  VETERAN_MIN_AGE_DAYS,
  classifyAd,
  classifyAds,
} from '../analyze';
import { NOW, makeAd } from './fixtures';

describe('classifyAd — veteran boundary (active, age ≥ 56d)', () => {
  it('active ad aged exactly 56 days IS a veteran', () => {
    // 2026-05-06 → 2026-07-01 = 25 (rest of May) + 30 (June) + 1 = 56 days.
    const ad = makeAd({ id: 'a', entity_id: 'e', first_seen: '2026-05-06' });
    expect(classifyAd(ad, NOW)).toBe('veteran');
  });

  it('active ad aged 55 days is NOT a veteran (standard)', () => {
    const ad = makeAd({ id: 'a', entity_id: 'e', first_seen: '2026-05-07' });
    expect(classifyAd(ad, NOW)).toBe('standard');
  });

  it('an INACTIVE old ad is never a veteran — longevity only counts while paying', () => {
    const ad = makeAd({ id: 'a', entity_id: 'e', first_seen: '2026-03-01', last_seen: '2026-06-25', active: false });
    expect(classifyAd(ad, NOW)).not.toBe('veteran');
  });
});

describe('classifyAd — churn boundary (inactive, lifespan ≤ 28d)', () => {
  it('inactive ad with exactly a 28-day lifespan IS churned', () => {
    // 2026-05-01 → 2026-05-29 = 28 days.
    const ad = makeAd({ id: 'a', entity_id: 'e', first_seen: '2026-05-01', last_seen: '2026-05-29', active: false });
    expect(classifyAd(ad, NOW)).toBe('churned');
  });

  it('inactive ad with a 29-day lifespan is NOT churned — a completed run, not a failed test', () => {
    const ad = makeAd({ id: 'a', entity_id: 'e', first_seen: '2026-05-01', last_seen: '2026-05-30', active: false });
    expect(classifyAd(ad, NOW)).toBe('standard');
  });

  it('a long-lived retired ad (92d lifespan) is standard, never churn', () => {
    const ad = makeAd({ id: 'a', entity_id: 'e', first_seen: '2026-03-01', last_seen: '2026-06-01', active: false });
    expect(classifyAd(ad, NOW)).toBe('standard');
  });
});

describe('classifyAd — fresh boundary (active, age < 14d)', () => {
  it('active ad aged 13 days is fresh', () => {
    const ad = makeAd({ id: 'a', entity_id: 'e', first_seen: '2026-06-18' });
    expect(classifyAd(ad, NOW)).toBe('fresh');
  });

  it('active ad aged exactly 14 days is standard (old enough to start judging)', () => {
    const ad = makeAd({ id: 'a', entity_id: 'e', first_seen: '2026-06-17' });
    expect(classifyAd(ad, NOW)).toBe('standard');
  });
});

describe('classifyAds — grouping', () => {
  it('buckets a mixed set into all four classes', () => {
    const ads = [
      makeAd({ id: 'vet',   entity_id: 'e', first_seen: '2026-03-01' }),                                          // veteran
      makeAd({ id: 'churn', entity_id: 'e', first_seen: '2026-05-01', last_seen: '2026-05-20', active: false }),  // churned
      makeAd({ id: 'fresh', entity_id: 'e', first_seen: '2026-06-28' }),                                          // fresh
      makeAd({ id: 'std',   entity_id: 'e', first_seen: '2026-06-01' }),                                          // standard (30d)
    ];
    const grouped = classifyAds(ads, NOW);
    expect(grouped.veterans.map((a) => a.id)).toEqual(['vet']);
    expect(grouped.churned.map((a) => a.id)).toEqual(['churn']);
    expect(grouped.fresh.map((a) => a.id)).toEqual(['fresh']);
    expect(grouped.standard.map((a) => a.id)).toEqual(['std']);
  });

  it('thresholds are the documented craft values (8w veteran / 4w churn / 2w fresh)', () => {
    expect(VETERAN_MIN_AGE_DAYS).toBe(56);
    expect(CHURN_MAX_LIFESPAN_DAYS).toBe(28);
    expect(FRESH_MAX_AGE_DAYS).toBe(14);
  });
});
