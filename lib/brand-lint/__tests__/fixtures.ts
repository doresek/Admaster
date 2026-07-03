// lib/brand-lint/__tests__/fixtures.ts
//
// Shared builders for the C-07 tests: a full BrandVoiceSpec and a full
// ClientInsight with sensible defaults, both overridable per test. No casts —
// every fixture is a complete, honestly-typed literal.

import type { ClientInsight } from '@/lib/intelligence/types';
import { DEFAULT_BRAND_VOICE, type BrandVoiceSpec } from '../types';

export function makeSpec(over: Partial<BrandVoiceSpec> = {}): BrandVoiceSpec {
  return {
    ...DEFAULT_BRAND_VOICE,
    address: { ...DEFAULT_BRAND_VOICE.address },
    taboo_words: [...DEFAULT_BRAND_VOICE.taboo_words],
    ...over,
  };
}

let seq = 0;

export function makeAtom(over: Partial<ClientInsight> = {}): ClientInsight {
  seq += 1;
  return {
    id:                `atom-${seq}`,
    client_id:         'client-1',
    owner_user_id:     'owner-1',
    layer:             'business',
    kind:              'brand_voice',
    content:           'קול המותג: ענייני וישיר',
    structured:        null,
    source:            'brief',
    source_ref:        null,
    confidence:        0.7,
    evidence_count:    1,
    status:            'active',
    superseded_by:     null,
    superseded_reason: null,
    first_seen_at:     '2026-01-01T00:00:00.000Z',
    updated_at:        '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
