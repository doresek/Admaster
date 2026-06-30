import { describe, it, expect } from 'vitest';
import {
  mapTargeting,
  mapObjective,
  mapGenders,
  mapPublisherPlatforms,
  ilsToAgorot,
} from '@/lib/campaigns';
import type { TargetingSpec as DecisionTargetingSpec } from '@/lib/decision-engine';

const baseSpec: DecisionTargetingSpec = {
  geo: 'IL',
  age_min: 30,
  age_max: 45,
  genders: 'female',
  interests: ['weekends back', 'admin overwhelm'],
};

describe('mapGenders', () => {
  it('maps the engine vocabulary to Graph numeric genders', () => {
    expect(mapGenders('male')).toEqual([1]);
    expect(mapGenders('female')).toEqual([2]);
    expect(mapGenders('all')).toBeUndefined(); // omit ⇒ target everyone
  });
});

describe('ilsToAgorot (minor units)', () => {
  it('converts major → minor units (×100, integer)', () => {
    expect(ilsToAgorot(80)).toBe(8000);
    expect(ilsToAgorot(12.34)).toBe(1234);
    expect(ilsToAgorot(0)).toBe(0);
    expect(ilsToAgorot(NaN as unknown as number)).toBe(0);
  });
});

describe('mapTargeting', () => {
  it('maps geo country code → geo_locations.countries', () => {
    const { targeting } = mapTargeting(baseSpec);
    expect(targeting.geo_locations).toEqual({ countries: ['IL'] });
  });

  it('passes age + numeric genders through', () => {
    const { targeting } = mapTargeting(baseSpec);
    expect(targeting.age_min).toBe(30);
    expect(targeting.age_max).toBe(45);
    expect(targeting.genders).toEqual([2]);
  });

  it("omits genders for 'all'", () => {
    const { targeting } = mapTargeting({ ...baseSpec, genders: 'all' });
    expect(targeting.genders).toBeUndefined();
  });

  it('passes interests as { name } with NO id, and flags the unresolved gap', () => {
    const { targeting, notes } = mapTargeting(baseSpec);
    expect(targeting.interests).toEqual([
      { id: '', name: 'weekends back' },
      { id: '', name: 'admin overwhelm' },
    ]);
    expect(notes.some((n) => /interest .*NO Meta/.test(n))).toBe(true);
  });

  it('falls back to country IL and notes a non-country geo (e.g. a city)', () => {
    const { targeting, notes } = mapTargeting({ ...baseSpec, geo: 'Tel Aviv' });
    expect(targeting.geo_locations).toEqual({ countries: ['IL'] });
    expect(notes.some((n) => /Tel Aviv/.test(n))).toBe(true);
  });

  it('records audience hints as unresolved notes (not on the spec)', () => {
    const { targeting, notes } = mapTargeting({
      ...baseSpec,
      custom_audience_hint: 'Retarget warm users',
      lookalike_hint: 'Lookalike from persona',
    });
    expect(targeting.custom_audiences).toBeUndefined();
    expect(targeting.lookalike_audiences).toBeUndefined();
    expect(notes.some((n) => /custom_audience_hint/.test(n))).toBe(true);
    expect(notes.some((n) => /lookalike_hint/.test(n))).toBe(true);
  });
});

describe('mapObjective', () => {
  it('maps engine objectives to Meta OUTCOME_* + db verb + goals', () => {
    expect(mapObjective('awareness').metaObjective).toBe('OUTCOME_AWARENESS');
    expect(mapObjective('traffic')).toMatchObject({
      metaObjective: 'OUTCOME_TRAFFIC',
      dbObjective: 'traffic',
      optimizationGoal: 'LINK_CLICKS',
    });
    expect(mapObjective('conversions').metaObjective).toBe('OUTCOME_SALES');
    expect(mapObjective('sales').dbObjective).toBe('conversions');
  });

  it('falls back to engagement on unknown / missing objective', () => {
    expect(mapObjective(undefined).metaObjective).toBe('OUTCOME_ENGAGEMENT');
    expect(mapObjective('nonsense').metaObjective).toBe('OUTCOME_ENGAGEMENT');
  });
});

describe('mapPublisherPlatforms', () => {
  it('maps the decision platform to Graph publisher_platforms', () => {
    expect(mapPublisherPlatforms('instagram')).toEqual(['instagram']);
    expect(mapPublisherPlatforms('facebook')).toEqual(['facebook']);
    expect(mapPublisherPlatforms('whatsapp')).toBeUndefined();
  });
});
