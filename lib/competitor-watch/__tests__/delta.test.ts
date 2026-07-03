// Delta report (skill §6.1): new veterans, kills, bursts, silences.
//
// Scenario clock: the previous watch ran on 2026-06-01 (PREV_NOW); this watch
// runs on 2026-07-01 (NOW). first_seen never changes between snapshots (the
// store's longevity invariant), so veteran TRANSITIONS are visible only by
// classifying the previous rows at their own observation time.

import { describe, expect, it } from 'vitest';
import { BURST_MIN_NEW_ADS, computeDelta } from '../analyze';
import { NOW, makeAd } from './fixtures';

const PREV_NOW = new Date('2026-06-01T00:00:00Z');

describe('computeDelta — new veterans', () => {
  it('detects an ad that AGED into veteran between watches', () => {
    // first_seen 2026-04-20: age 42d at PREV_NOW (not veteran), 72d at NOW (veteran).
    const ad = makeAd({ id: 'a1', entity_id: 'e1', first_seen: '2026-04-20', platform_ad_ref: 'r1' });
    const delta = computeDelta([ad], [ad], { now: NOW, prevNow: PREV_NOW });
    expect(delta.new_veterans.map((v) => v.platform_ad_ref)).toEqual(['r1']);
  });

  it('does NOT re-report an ad that was already a veteran last watch', () => {
    // first_seen 2026-03-01: 92d at PREV_NOW — veteran both times.
    const ad = makeAd({ id: 'a1', entity_id: 'e1', first_seen: '2026-03-01', platform_ad_ref: 'r1' });
    const delta = computeDelta([ad], [ad], { now: NOW, prevNow: PREV_NOW });
    expect(delta.new_veterans).toEqual([]);
  });

  it('detects a newly-observed ad that is ALREADY old (pasted with an early first_seen)', () => {
    const ad = makeAd({ id: 'a1', entity_id: 'e1', first_seen: '2026-03-01', platform_ad_ref: 'r1' });
    const delta = computeDelta([], [ad], { now: NOW, prevNow: PREV_NOW });
    expect(delta.new_veterans.map((v) => v.platform_ad_ref)).toEqual(['r1']);
    // the delta carries the decoded angle + an excerpt for the report
    expect(delta.new_veterans[0].entity_id).toBe('e1');
  });
});

describe('computeDelta — kills', () => {
  it('reports an ad that flipped active → inactive', () => {
    const prev = makeAd({ id: 'a1', entity_id: 'e1', first_seen: '2026-05-01', platform_ad_ref: 'r1' });
    const cur  = makeAd({ id: 'a1', entity_id: 'e1', first_seen: '2026-05-01', platform_ad_ref: 'r1', active: false, last_seen: '2026-06-20' });
    const delta = computeDelta([prev], [cur], { now: NOW, prevNow: PREV_NOW });
    expect(delta.newly_killed.map((k) => k.platform_ad_ref)).toEqual(['r1']);
  });

  it('an ad inactive in BOTH snapshots is not a new kill', () => {
    const ad = makeAd({ id: 'a1', entity_id: 'e1', first_seen: '2026-04-01', platform_ad_ref: 'r1', active: false, last_seen: '2026-04-20' });
    const delta = computeDelta([ad], [ad], { now: NOW, prevNow: PREV_NOW });
    expect(delta.newly_killed).toEqual([]);
  });
});

describe('computeDelta — bursts and silences (skill §2.4 volume moves)', () => {
  it(`flags a burst at ≥ ${BURST_MIN_NEW_ADS} previously-unseen ads from one entity`, () => {
    const cur = [1, 2, 3].map((n) =>
      makeAd({ id: `a${n}`, entity_id: 'e1', first_seen: '2026-06-25', platform_ad_ref: `r${n}` }),
    );
    const delta = computeDelta([], cur, { now: NOW });
    expect(delta.bursts).toEqual([{ entity_id: 'e1', new_ads: 3 }]);
  });

  it('2 new ads is not a burst', () => {
    const cur = [1, 2].map((n) =>
      makeAd({ id: `a${n}`, entity_id: 'e1', first_seen: '2026-06-25', platform_ad_ref: `r${n}` }),
    );
    const delta = computeDelta([], cur, { now: NOW });
    expect(delta.bursts).toEqual([]);
  });

  it('flags silence when an entity goes from ≥1 active ad to ALL inactive', () => {
    const prev = makeAd({ id: 'a1', entity_id: 'e1', first_seen: '2026-05-01', platform_ad_ref: 'r1' });
    const cur  = makeAd({ id: 'a1', entity_id: 'e1', first_seen: '2026-05-01', platform_ad_ref: 'r1', active: false, last_seen: '2026-06-15' });
    const delta = computeDelta([prev], [cur], { now: NOW, prevNow: PREV_NOW });
    expect(delta.silences).toEqual([{ entity_id: 'e1' }]);
  });

  it('no silence when the entity still has an active ad, or was already silent', () => {
    const stillActive = [
      makeAd({ id: 'a1', entity_id: 'e1', first_seen: '2026-05-01', platform_ad_ref: 'r1', active: false, last_seen: '2026-06-15' }),
      makeAd({ id: 'a2', entity_id: 'e1', first_seen: '2026-05-01', platform_ad_ref: 'r2' }),
    ];
    expect(computeDelta(stillActive, stillActive, { now: NOW }).silences).toEqual([]);

    const alreadySilent = makeAd({ id: 'a1', entity_id: 'e1', first_seen: '2026-04-01', platform_ad_ref: 'r1', active: false, last_seen: '2026-04-20' });
    expect(computeDelta([alreadySilent], [alreadySilent], { now: NOW }).silences).toEqual([]);
  });
});
