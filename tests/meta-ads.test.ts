import { describe, it, expect } from 'vitest';
import {
  buildObjectStorySpec, destinationToObjective, defaultCtaFor, destinationLink,
} from '@/lib/meta-ads';
import type { Destination } from '@/types';

// meta-targeting instantiates the Anthropic SDK at import time, which throws
// without a key — give it a dummy one, then dynamic-import inside the test.
process.env.ANTHROPIC_API_KEY ||= 'test-key';

describe('destinationToObjective', () => {
  it('maps each destination to its Meta objective', () => {
    expect(destinationToObjective('landing_page')).toBe('OUTCOME_TRAFFIC');
    expect(destinationToObjective('external_url')).toBe('OUTCOME_TRAFFIC');
    expect(destinationToObjective('whatsapp')).toBe('OUTCOME_ENGAGEMENT');
    expect(destinationToObjective('lead_form')).toBe('OUTCOME_LEADS');
  });
});

describe('defaultCtaFor', () => {
  it('picks a sensible default CTA per destination', () => {
    expect(defaultCtaFor('landing_page')).toBe('LEARN_MORE');
    expect(defaultCtaFor('whatsapp')).toBe('WHATSAPP_MESSAGE');
    expect(defaultCtaFor('lead_form')).toBe('SIGN_UP');
  });
});

describe('destinationLink', () => {
  const app = 'https://app.example.com/';
  it('builds an /lp/<slug> URL for landing pages', () => {
    expect(destinationLink({ type: 'landing_page', value: 'summer' }, app)).toBe('https://app.example.com/lp/summer');
  });
  it('passes through an external URL', () => {
    expect(destinationLink({ type: 'external_url', value: 'https://x.co/y' }, app)).toBe('https://x.co/y');
  });
  it('builds a wa.me link from digits only', () => {
    expect(destinationLink({ type: 'whatsapp', value: '+972 50-123-4567' }, app)).toBe('https://wa.me/972501234567');
  });
});

describe('buildObjectStorySpec', () => {
  const base = { pageId: 'PAGE', headline: 'Buy now', primaryText: 'Great offer', imageHash: 'HASH', link: 'https://dest/' };

  it('builds a link ad for a landing page', () => {
    const spec: any = buildObjectStorySpec({ ...base, destination: { type: 'landing_page', value: 's' } });
    expect(spec.page_id).toBe('PAGE');
    expect(spec.link_data.name).toBe('Buy now');
    expect(spec.link_data.message).toBe('Great offer');
    expect(spec.link_data.image_hash).toBe('HASH');
    expect(spec.link_data.call_to_action.type).toBe('LEARN_MORE');
    expect(spec.link_data.call_to_action.value.link).toBe('https://dest/');
  });

  it('embeds the lead_gen_form_id for lead forms', () => {
    const dest: Destination = { type: 'lead_form', value: 'FORM123' };
    const spec: any = buildObjectStorySpec({ ...base, destination: dest });
    expect(spec.link_data.call_to_action.type).toBe('SIGN_UP');
    expect(spec.link_data.call_to_action.value.lead_gen_form_id).toBe('FORM123');
  });

  it('uses a WhatsApp CTA for whatsapp destinations', () => {
    const spec: any = buildObjectStorySpec({ ...base, destination: { type: 'whatsapp', value: '972500000000' } });
    expect(spec.link_data.call_to_action.type).toBe('WHATSAPP_MESSAGE');
    expect(spec.link_data.call_to_action.value.app_destination).toBe('WHATSAPP');
  });

  it('honors an explicit CTA override', () => {
    const spec: any = buildObjectStorySpec({ ...base, destination: { type: 'landing_page', value: 's' }, cta: 'SHOP_NOW' });
    expect(spec.link_data.call_to_action.type).toBe('SHOP_NOW');
  });
});

describe('toMetaTargetingSpec', () => {
  it('maps genders, geo, interests (id-only) and age', async () => {
    const { toMetaTargetingSpec } = await import('@/lib/meta-targeting');
    const spec: any = toMetaTargetingSpec({
      ageMin: 25, ageMax: 45, genders: 'female',
      geo: { countries: ['IL'] },
      interests: [{ id: '111', name: 'Fitness' }, { name: 'Unresolved' }],
      dailyBudget: 7000, rationale: '',
    });
    expect(spec.age_min).toBe(25);
    expect(spec.age_max).toBe(45);
    expect(spec.genders).toEqual([2]);
    expect(spec.geo_locations.countries).toEqual(['IL']);
    expect(spec.interests).toEqual([{ id: '111', name: 'Fitness' }]); // unresolved dropped
  });

  it('omits genders for "all"', async () => {
    const { toMetaTargetingSpec } = await import('@/lib/meta-targeting');
    const spec: any = toMetaTargetingSpec({
      ageMin: 18, ageMax: 65, genders: 'all',
      geo: { countries: ['IL'] }, interests: [], dailyBudget: 5000, rationale: '',
    });
    expect(spec.genders).toBeUndefined();
  });
});
