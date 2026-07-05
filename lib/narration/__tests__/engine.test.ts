// narrate — the generalized digest discipline, tested the digest's way:
//   1. ANTI-HALLUCINATION: every numeric token in the text appears in the
//      serialized inputs (the engine can echo, never mint);
//   2. sources = exactly the contributing fact ids (namespaced);
//   3. byte-determinism + shuffle-invariance;
//   4. Hebrew agreement (both branches) + verdict phrasing;
//   5. register discipline: owner has zero jargon tokens, marketer is fuller.

import { describe, expect, it } from 'vitest';
import { narrate } from '../engine';
import { clinicNarrationInput, emptyNarrationInput, makeMetric } from './fixtures';

/** All numeric tokens in a string (whitelist source + scan target). */
const numericTokens = (s: string): string[] =>
  [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);

describe('narrate — anti-hallucination invariant (§0.2)', () => {
  it('every numeric token in the text exists in the inputs (owner + marketer)', () => {
    const input = clinicNarrationInput();
    const whitelist = new Set(numericTokens(JSON.stringify(input)));
    expect(whitelist.size).toBeGreaterThan(0);
    for (const register of ['owner', 'marketer'] as const) {
      const { text_he } = narrate(input, register);
      // Line 1 is the period header — the same input date, IL-reordered
      // ('2026-06-22' → '22.06.2026'); every OTHER line must echo verbatim.
      const body = text_he.split('\n').slice(1).join('\n');
      const scanned = numericTokens(body);
      expect(scanned.length, register).toBeGreaterThan(0);
      for (const n of scanned) {
        expect(whitelist.has(n), `${register}: rendered ${n} is not present in any input fact`).toBe(true);
      }
    }
  });

  it('₪-amounts and percentages specifically all trace to inputs', () => {
    const input = clinicNarrationInput();
    const whitelist = new Set(numericTokens(JSON.stringify(input)));
    const { text_he } = narrate(input, 'marketer');
    const scanned = [...text_he.matchAll(/₪\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?%/g)]
      .map((m) => m[1] ?? m[2]);
    expect(scanned.length).toBeGreaterThan(0); // ₪87.5, ₪700, ₪7000, 100%, 34.6% …
    for (const n of scanned) {
      expect(whitelist.has(n), `rendered ${n} (₪/%) is not in any input`).toBe(true);
    }
  });

  it('sources are exactly the contributing fact ids, namespaced and sorted', () => {
    const { sources } = narrate(clinicNarrationInput(), 'marketer');
    expect(sources).toEqual([
      'action:act-refresh',
      'atom:atom-safety',
      'atom:atom-stale',
      'diagnosis:diag-fatigue',
      'metric:close_rate',            // narrated as not-computable (marketer)
      'metric:closed_value',
      'metric:cost_per_lead',
      'metric:leads_total',
      'metric:qualified_rate',
      'metric:reconciliation_ratio',
      'metric:roas_vs_breakeven',
      'metric:spend_total',
    ]);
  });

  it('owner sources exclude hidden/not-computable metrics (they moved to warnings)', () => {
    const { sources, warnings } = narrate(clinicNarrationInput(), 'owner');
    expect(sources).not.toContain('metric:reconciliation_ratio');
    expect(sources).not.toContain('metric:close_rate');
    expect(warnings.some((w) => w.includes('close_rate'))).toBe(true);
  });

  it('missing atom confidence is cited as missing — never invented — with a warning', () => {
    const { text_he, warnings } = narrate(clinicNarrationInput(), 'owner');
    expect(text_he).toContain('"קהל צעיר מגיב לוידאו קצר" (ללא ביטחון רשום)');
    expect(text_he).toContain('"ההורים קונים שקט נפשי, לא טכנולוגיה" (ביטחון 0.85)');
    expect(warnings.some((w) => w.includes('atom-stale'))).toBe(true);
  });

  it('diagnosis rationales are narrated VERBATIM with their campaign scope', () => {
    const { text_he } = narrate(clinicNarrationInput(), 'owner');
    expect(text_he).toContain('למה (קמפיין שקט נפשי): הקהל ראה את המודעה 4 פעמים — עייפות קריאייטיב, לא בעיית הצעה');
  });
});

describe('narrate — determinism', () => {
  it('same inputs → byte-identical text, sources and warnings', () => {
    const a = narrate(clinicNarrationInput(), 'owner');
    const b = narrate(clinicNarrationInput(), 'owner');
    expect(b.text_he).toBe(a.text_he);
    expect(b.sources).toEqual(a.sources);
    expect(b.warnings).toEqual(a.warnings);
  });

  it('shuffled fact order → identical output (fixed narration order)', () => {
    const shuffled = clinicNarrationInput();
    shuffled.metrics.reverse();
    shuffled.diagnoses.reverse();
    shuffled.atoms.reverse();
    shuffled.pendingActions.reverse();
    const a = narrate(clinicNarrationInput(), 'marketer');
    const b = narrate(shuffled, 'marketer');
    expect(b.text_he).toBe(a.text_he);
    expect(b.sources).toEqual(a.sources);
  });
});

describe('narrate — Hebrew craft', () => {
  it('one-line story comes FIRST: leads · cost-per-lead · worth-it', () => {
    const lines = narrate(clinicNarrationInput(), 'owner').text_he.split('\n');
    expect(lines[0]).toBe('תקופה: 22.06.2026–28.06.2026');
    expect(lines[1]).toBe('8 לידים · ₪87.5 לליד · משתלם ✅');
  });

  it('singular agreement: 1 → "ליד אחד"; plural: 2 → "2 לידים"', () => {
    const one = emptyNarrationInput();
    one.metrics = [makeMetric({ key: 'leads_total', name_he: 'לידים', value: 1 })];
    expect(narrate(one, 'owner').text_he).toContain('ליד אחד');

    const two = emptyNarrationInput();
    two.metrics = [makeMetric({ key: 'leads_total', name_he: 'לידים', value: 2 })];
    const text = narrate(two, 'owner').text_he;
    expect(text).toContain('2 לידים');
    expect(text).not.toContain('ליד אחד');
  });

  it('verdict phrasing follows direction: up_good ↑ = שיפור, down_good ↑ = טעון תשומת לב', () => {
    const { text_he } = narrate(clinicNarrationInput(), 'marketer');
    expect(text_he).toContain('↑100% — שיפור');            // leads_total, up_good rising
    expect(text_he).toContain('↑34.6% — טעון תשומת לב');   // cost_per_lead, down_good rising
  });

  it('goal + benchmark clauses are direction-aware and echo the target', () => {
    const { text_he } = narrate(clinicNarrationInput(), 'marketer');
    expect(text_he).toContain('מתחת ליעד (10)');            // leads 8 vs goal 10, up_good unmet
    expect(text_he).toContain('חורג מהצפוי (פי 1.2)');      // reconciliation vs benchmark unmet
  });

  it('honesty labels ride along every attribution-derived number', () => {
    const { text_he } = narrate(clinicNarrationInput(), 'owner');
    expect(text_he).toContain('[מבוסס קליקים]');
    expect(text_he).toContain('[תקציב מתוכנן — לא הוצאה בפועל מהפלטפורמה]');
  });

  it('nothing computable → honest empty story, no fabricated numbers', () => {
    const { text_he } = narrate(emptyNarrationInput(), 'owner');
    expect(text_he).toContain('עוד אין מספיק נתונים לתקופה הזו');
    expect([...text_he.matchAll(/₪\s?\d/g)]).toHaveLength(0);
  });
});

describe('narrate — register discipline (§1 viewer modes)', () => {
  it('owner text contains ZERO platform jargon tokens', () => {
    const { text_he } = narrate(clinicNarrationInput(), 'owner');
    expect(/ROAS|CTR|CPM|CPA|CRM/.test(text_he)).toBe(false);
  });

  it('marketer gets the fuller vocabulary over the SAME facts', () => {
    const { text_he } = narrate(clinicNarrationInput(), 'marketer');
    expect(text_he).toContain('ROAS מול נקודת איזון');
    expect(text_he).toContain('יחס דיווח פלטפורמה מול CRM');
    expect(text_he).toContain('(create_paid_paused)');   // machine verb for traceability
  });

  it('owner renders worth-it framing for ROAS; below break-even flips the verdict', () => {
    const above = narrate(clinicNarrationInput(), 'owner').text_he;
    expect(above).toContain('הפרסום משתלם — פי 4 מנקודת האיזון ✅');

    const input = clinicNarrationInput();
    input.metrics = input.metrics.map((m) =>
      m.key === 'roas_vs_breakeven' ? { ...m, value: 0.8 } : m);
    const below = narrate(input, 'owner').text_he;
    expect(below).toContain('הפרסום עדיין לא משתלם — פי 0.8 מנקודת האיזון ⚠️');
    expect(below).toContain('עדיין לא משתלם ⚠️'); // headline verdict flips too
  });

  it('marketer sees not-computable reasons inline; owner screen stays clean', () => {
    const marketer = narrate(clinicNarrationInput(), 'marketer').text_he;
    expect(marketer).toContain('אחוז סגירה: לא ניתן לחישוב — אף עסקה לא הוכרעה בתקופה');
    const owner = narrate(clinicNarrationInput(), 'owner').text_he;
    expect(owner).not.toContain('אחוז סגירה');
  });
});
