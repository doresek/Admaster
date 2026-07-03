// composeDigest / renderHebrew — the §1.3 audit-trail contract, tested.
//
// THE AUDIT-TRAIL INVARIANT: every substantive line of rendered_text traces to
// an input row. Proven three ways below:
//   1. each fixture row's key phrase appears VERBATIM in the narrative;
//   2. `sources` contains exactly the contributing row ids;
//   3. (anti-hallucination) every ₪-amount / percentage in the rendered text
//      appears somewhere in the serialized inputs — the composer can echo row
//      numbers but can never mint a new one.

import { describe, expect, it } from 'vitest';
import { composeDigest, renderHebrew } from '../compose';
import type { DigestInputs } from '../types';
import {
  APPROVAL_RATIONALE,
  ATOM_CONTENT_SAFETY,
  CLAIM_OPEN,
  CLAIM_RESOLVED,
  DIAGNOSIS_RATIONALE,
  PRECEDENT_RATIONALE,
  VERDICT_REASON,
  dentalWeekInputs,
  emptyWeekInputs,
} from './fixtures';

/** All numeric tokens in a string (whitelist source + scan target). */
const numericTokens = (s: string): string[] =>
  [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);

describe('composeDigest — audit-trail invariant (§1.3)', () => {
  it('narrates every fixture row verbatim: rationales, angles, claims', () => {
    const { rendered_text: text, warnings } = composeDigest(dentalWeekInputs());

    // what ran — angle names from the decision rows
    expect(text).toContain("זווית 'ביטחון רגשי'");
    expect(text).toContain("זווית 'זווית המחיר'");
    // grounding citation — atom content verbatim
    expect(text).toContain(ATOM_CONTENT_SAFETY);
    // diagnosis rationale — VERBATIM from the row, including its own numerics
    expect(text).toContain(DIAGNOSIS_RATIONALE);
    // hypotheses — claims verbatim, correct resolution verb
    expect(text).toContain(`ההשערה "${CLAIM_RESOLVED}" אושרה`);
    expect(text).toContain(VERDICT_REASON);
    expect(text).toContain(CLAIM_OPEN);
    // precedents decision row → episodic-memory note
    expect(text).toContain(PRECEDENT_RATIONALE);
    // budget decision rationale (non-angle decision narrated under its campaign)
    expect(text).toContain('תקציב פתיחה שמרני עד שהזרוע מוכיחה את עצמה');
    // approvals passthrough
    expect(text).toContain(APPROVAL_RATIONALE);
    // the only expected warning is the missing grounding atom
    expect(warnings).toHaveLength(1);
  });

  it('sources contains exactly the contributing row ids', () => {
    const { sources } = composeDigest(dentalWeekInputs());
    expect(sources.campaign_ids).toEqual(['camp-price', 'camp-safety']);
    expect(sources.decision_ids).toEqual(
      ['dec-angle-price', 'dec-angle-safety', 'dec-budget-safety', 'dec-precedents'],
    );
    expect(sources.diagnosis_ids).toEqual(['diag-funnel']);
    expect(sources.hypothesis_ids).toEqual(['hyp-lookalike', 'hyp-supported']);
  });

  it('anti-hallucination: every ₪-amount and percentage traces to an input row', () => {
    const inputs = dentalWeekInputs();
    const { rendered_text: text } = composeDigest(inputs);

    // Whitelist: every numeric token anywhere in the recorded rows.
    const whitelist = new Set(numericTokens(JSON.stringify(inputs)));
    expect(whitelist.size).toBeGreaterThan(0);

    // Scan: numbers attached to ₪ or % in the narrative.
    const scanned = [...text.matchAll(/₪\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?%/g)]
      .map((m) => m[1] ?? m[2]);
    expect(scanned.length).toBeGreaterThan(0); // ₪40, ₪378, ₪27, 32%, 3% …
    for (const n of scanned) {
      expect(whitelist.has(n), `rendered ${n} (₪/%) is not present in any input row`).toBe(true);
    }
  });

  it('confidence citation: atom confidence appears beside the angle; missing atom → no confidence + warning', () => {
    const { rendered_text: text, warnings, content } = composeDigest(dentalWeekInputs());

    // grounded atom @0.85 → cited with its confidence
    expect(text).toContain('ביטחון 0.85');
    // missing atom id → clause renders WITHOUT a confidence, warning collected
    expect(text).toContain('מבוססת על תובנה מתועדת שאינה זמינה עוד');
    expect(warnings.some((w) => w.includes('atom-gone'))).toBe(true);
    const priceItem = content.sections.what_ran.find((w) => w.campaign_id === 'camp-price');
    expect(priceItem?.grounding).toEqual([{ insight_id: 'atom-gone', content: null, confidence: null }]);
  });

  it('missing-performance honesty: unmeasured campaign says awaiting-data, no invented numbers', () => {
    const { rendered_text: text, content } = composeDigest(dentalWeekInputs());

    expect(text).toContain('קמפיין זווית המחיר: הנתונים עוד לא נכנסו מהפלטפורמה');
    expect(content.sections.results.awaiting).toEqual([
      { campaign_id: 'camp-price', campaign_name: 'קמפיין זווית המחיר' },
    ]);
    // the measured campaign echoes its row metrics verbatim
    expect(text).toContain('המרות 14');
    expect(text).toContain('עלות להמרה ₪27');
    expect(text).toContain('הוצאה ₪378');
  });

  it('empty period → honest quiet digest, not an error', () => {
    const result = composeDigest(emptyWeekInputs());
    expect(result.rendered_text).toContain('שבוע שקט — אין קמפיינים פעילים');
    expect(result.sources).toEqual({
      campaign_ids: [], decision_ids: [], diagnosis_ids: [], hypothesis_ids: [],
    });
    expect(result.warnings).toEqual([]);
    // approvals section still present so the owner knows nothing is pending
    expect(result.rendered_text).toContain('אין פעולות שממתינות לאישורך');
  });

  it('monthly empty period uses the monthly phrasing', () => {
    const inputs = emptyWeekInputs();
    inputs.period = { kind: 'monthly', start: '2026-06-01', end: '2026-06-30' };
    const { rendered_text: text } = composeDigest(inputs);
    expect(text).toContain('סיכום חודשי');
    expect(text).toContain('חודש שקט — אין קמפיינים פעילים');
  });
});

describe('renderHebrew — grammar craft', () => {
  it('singular agreement: one campaign → "רץ קמפיין אחד"', () => {
    const inputs = dentalWeekInputs();
    inputs.campaigns = inputs.campaigns.filter((c) => c.id === 'camp-safety');
    const { rendered_text: text } = composeDigest(inputs);
    expect(text).toContain('השבוע רץ קמפיין אחד:');
    expect(text).not.toContain('השבוע רצו');
  });

  it('plural agreement: two campaigns → "רצו 2 קמפיינים"', () => {
    const { rendered_text: text } = composeDigest(dentalWeekInputs());
    expect(text).toContain('השבוע רצו 2 קמפיינים:');
    expect(text).not.toContain('קמפיין אחד');
  });

  it('dates render in IL format (dd.mm.yyyy)', () => {
    const { rendered_text: text } = composeDigest(dentalWeekInputs());
    expect(text).toContain('22.06.2026–28.06.2026');
  });
});

describe('composeDigest — determinism & totality', () => {
  it('same inputs → byte-identical content and rendered_text', () => {
    const a = composeDigest(dentalWeekInputs());
    const b = composeDigest(dentalWeekInputs());
    expect(b.rendered_text).toBe(a.rendered_text);
    expect(JSON.stringify(b.content)).toBe(JSON.stringify(a.content));
    expect(b.sources).toEqual(a.sources);
  });

  it('shuffled input order → identical output (stable sorts by date/id)', () => {
    const shuffled: DigestInputs = dentalWeekInputs();
    shuffled.campaigns.reverse();
    shuffled.decisions.reverse();
    shuffled.diagnoses.reverse();
    shuffled.performance.reverse();
    shuffled.insights.reverse();
    shuffled.items.reverse();
    shuffled.hypotheses.resolved.reverse();
    shuffled.hypotheses.open.reverse();
    shuffled.approvalsNeeded.reverse();

    const a = composeDigest(dentalWeekInputs());
    const b = composeDigest(shuffled);
    expect(b.rendered_text).toBe(a.rendered_text);
    expect(JSON.stringify(b.content)).toBe(JSON.stringify(a.content));
  });

  it('is total: malformed partial rows are skipped with warnings, never a throw', () => {
    const inputs = dentalWeekInputs();
    // empty rationale on a decision; resolved bucket polluted with an open row
    inputs.decisions.push({
      id: 'dec-broken', campaign_id: 'camp-safety', client_id: 'client-dental-1',
      owner_user_id: 'owner-1', decision_type: 'audience', decision: {},
      grounded_in: [], rationale: '', created_at: '2026-06-24T08:00:00Z',
    });
    inputs.hypotheses.resolved.push({ ...inputs.hypotheses.open[0], id: 'hyp-still-open' });
    // performance row pointing at an unknown item
    inputs.performance.push({ ...inputs.performance[0], id: 'perf-orphan', campaign_item_id: 'item-unknown' });

    const result = composeDigest(inputs);
    expect(result.warnings.some((w) => w.includes('dec-broken'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('hyp-still-open'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('perf-orphan'))).toBe(true);
    // skipped rows never reach sources
    expect(result.sources.decision_ids).not.toContain('dec-broken');
    expect(result.sources.hypothesis_ids).not.toContain('hyp-still-open');
  });

  it('renderHebrew is a pure function of content (re-render is identical)', () => {
    const { content, rendered_text } = composeDigest(dentalWeekInputs());
    expect(renderHebrew(content)).toBe(rendered_text);
    expect(renderHebrew(JSON.parse(JSON.stringify(content)))).toBe(rendered_text);
  });
});
