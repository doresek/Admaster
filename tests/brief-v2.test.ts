// Tests for Brief v2 — Group A required-satisfaction predicate (lib/brief-v2.ts)
// and the server submit gate (app/api/briefs/submit/route.ts).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  REQUIRED_OWNER_KEYS,
  UNSURE_SENTINEL,
  isUnsure,
  isRequiredSatisfied,
  countSatisfiedRequired,
  allRequiredSatisfied,
} from '@/lib/brief-v2';

// ── A valid, fully-answered Group A (each ≥ 10 trimmed chars) ──────────────
function fullGroupA(): Record<string, string> {
  const v: Record<string, string> = {};
  for (const k of REQUIRED_OWNER_KEYS) v[k] = 'תשובה אמיתית מספיק ארוכה';
  return v;
}

describe('isRequiredSatisfied', () => {
  it('true when trimmed text length ≥ 10', () => {
    expect(isRequiredSatisfied('1234567890')).toBe(true);
    expect(isRequiredSatisfied('  עשר תווים פלוס  ')).toBe(true);
  });

  it('false when trimmed text length < 10 and no escape', () => {
    expect(isRequiredSatisfied('short')).toBe(false);
    expect(isRequiredSatisfied('         ')).toBe(false); // whitespace only
    expect(isRequiredSatisfied('')).toBe(false);
    expect(isRequiredSatisfied(undefined)).toBe(false);
    expect(isRequiredSatisfied(null)).toBe(false);
  });

  it('true when the unsure escape is active (string sentinel or { unsure:true })', () => {
    expect(isRequiredSatisfied(UNSURE_SENTINEL)).toBe(true);
    expect(isRequiredSatisfied({ unsure: true })).toBe(true);
    expect(isUnsure(UNSURE_SENTINEL)).toBe(true);
    expect(isUnsure({ unsure: true })).toBe(true);
    expect(isUnsure('regular answer')).toBe(false);
  });
});

describe('countSatisfiedRequired / allRequiredSatisfied', () => {
  it('counts only satisfied required keys; ignores Group B', () => {
    const values = { ...fullGroupA(), biz_name: 'x' };
    expect(countSatisfiedRequired(values)).toBe(REQUIRED_OWNER_KEYS.length);
    expect(allRequiredSatisfied(values)).toBe(true);
  });

  it('an under-filled Group A is NOT satisfied', () => {
    const values = fullGroupA();
    values[REQUIRED_OWNER_KEYS[0]] = 'short'; // < 10 chars, no escape
    expect(allRequiredSatisfied(values)).toBe(false);
    expect(countSatisfiedRequired(values)).toBe(REQUIRED_OWNER_KEYS.length - 1);
  });

  it('the unsure escape satisfies a required question (mixed with real answers)', () => {
    const values = fullGroupA();
    values[REQUIRED_OWNER_KEYS[1]] = UNSURE_SENTINEL;
    expect(allRequiredSatisfied(values)).toBe(true);
  });

  it('empty/missing values → 0 satisfied', () => {
    expect(countSatisfiedRequired({})).toBe(0);
    expect(allRequiredSatisfied(null)).toBe(false);
    expect(allRequiredSatisfied(undefined)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// Server submit gate — rejects an under-filled Group A before any DB hit.
// ════════════════════════════════════════════════════════════════
const h = vi.hoisted(() => ({ inserted: [] as any[] }));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        insert: (row: any) => { h.inserted.push(row); return builder; },
        single: async () =>
          table === 'brief_codes'
            ? { data: { code: 'ABC123', user_id: 'u1', client_id: null }, error: null }
            : { data: { id: 'brief-1', client_id: null }, error: null },
      };
      return builder;
    },
  }),
}));
vi.mock('@/lib/journey', () => ({ advanceJourneyOnBrief: vi.fn(async () => {}) }));
vi.mock('@/lib/client-core/orchestrator', () => ({ orchestrateClientCore: vi.fn(async () => {}) }));

import { POST } from '@/app/api/briefs/submit/route';

const TOKEN = 'a'.repeat(64); // matches /^[a-f0-9]{64}$/

let ipSeq = 0;
function makeReq(body: any): any {
  // Unique IP per request so the in-memory rate-limiter never trips across tests.
  return new Request('http://localhost/api/briefs/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.0.${++ipSeq}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => { h.inserted = []; });

describe('POST /api/briefs/submit — Group A gate', () => {
  it('rejects (400) an under-filled Group A and never inserts', async () => {
    const values = fullGroupA();
    values[REQUIRED_OWNER_KEYS[0]] = 'too short'; // < 10 chars, no escape
    const res = await POST(makeReq({ token: TOKEN, values }));
    expect(res.status).toBe(400);
    expect(h.inserted).toHaveLength(0);
  });

  it('rejects (400) when a required key is entirely missing', async () => {
    const values = fullGroupA();
    delete values[REQUIRED_OWNER_KEYS[2]];
    const res = await POST(makeReq({ token: TOKEN, values }));
    expect(res.status).toBe(400);
    expect(h.inserted).toHaveLength(0);
  });

  it('accepts a satisfied Group A (real answers + unsure escape) and inserts the brief', async () => {
    const values = fullGroupA();
    values[REQUIRED_OWNER_KEYS[0]] = UNSURE_SENTINEL; // escape satisfies
    const res = await POST(makeReq({ token: TOKEN, values }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0].values[REQUIRED_OWNER_KEYS[0]]).toBe(UNSURE_SENTINEL);
  });
});
