// Deep tests for the PURE architecture synthesis (skill §2 projection logic):
// core-promise selection + fallback chain, deterministic clustering, proof
// assignment (each hand-reasoned in fixtures.ts), grounded_in completeness,
// determinism/order-stability, and the structural diff.

import { describe, expect, it } from 'vitest';
import {
  PILLAR_KEYS,
  clusterByContent,
  diffArchitectures,
  synthesizeArchitecture,
  titleFrom,
} from '../architecture';
import { allAtoms, atom, dentalFixtures, resetAtomSeq } from './fixtures';

const synth = (insights = allAtoms()) => synthesizeArchitecture({ insights });

describe('synthesizeArchitecture — full dental fixture set', () => {
  const f = dentalFixtures();
  const { architecture: arch, warnings } = synthesizeArchitecture({ insights: allAtoms(f) });

  it('selects the highest-confidence value_translation atom as the core promise', () => {
    expect(arch.core_promise).toEqual({
      text:       'ביטחון בחיוך → ביטחון בחיים',
      insight_id: f.translation.id,
      confidence: 0.9,
    });
  });

  it('builds all four pillars with the argued-correct anchors', () => {
    expect(arch.pillars.map((p) => p.key)).toEqual([
      PILLAR_KEYS.desire, PILLAR_KEYS.objection, PILLAR_KEYS.mechanism, PILLAR_KEYS.identity,
    ]);

    const [desire, objection, mechanism, identity] = arch.pillars;
    // desire1+desire2 cluster (Jaccard 0.67); desire3 is a separate weaker cluster.
    expect(desire.insight_ids).toEqual([f.desire1.id, f.desire2.id]);
    expect(desire.title).toBe('לחייך בביטחון בלי להתבייש');
    // price objection (0.8) outranks the pain-fear objection (0.75).
    expect(objection.insight_ids).toEqual([f.objPrice.id]);
    // mechanism = real_solution (anchor, 0.8) + pain_solved (0.65).
    expect(mechanism.insight_ids).toEqual([f.mechanism.id, f.painSolved.id]);
    // identity = persona (0.75) + unspoken_want (0.55).
    expect(identity.insight_ids).toEqual([f.persona.id, f.unspokenWant.id]);
  });

  it('every pillar declares its awareness gradient and kind cluster', () => {
    for (const p of arch.pillars) {
      expect(p.awareness_notes).toBeTruthy();
      expect(p.kind_cluster.length).toBeGreaterThan(0);
      expect(p.insight_ids.length).toBeGreaterThan(0);
    }
  });

  it('assigns each proof to its argued-correct pillar (see fixture comments)', () => {
    // proofSmiles: testimonial about confident smiles → argues the DESIRE.
    // proofPayment: payment-split receipt → neutralizes the PRICE objection.
    expect(arch.proof_map).toEqual([
      { proof_insight_id: f.proofSmiles.id,  pillar_key: PILLAR_KEYS.desire },
      { proof_insight_id: f.proofPayment.id, pillar_key: PILLAR_KEYS.objection },
    ]);
  });

  it('flags the unmatched proof as unused ammunition (never force-assigns)', () => {
    expect(arch.unassigned).toEqual([
      {
        proof_insight_id: f.proofAward.id,
        reason: "no content match with any pillar's atoms — unused ammunition",
      },
    ]);
    expect(warnings.some((w) => w.includes('unused ammunition'))).toBe(true);
  });

  it('grounded_in contains exactly the used atoms (promise + members + assigned proofs)', () => {
    const expected = [
      f.translation.id,
      f.desire1.id, f.desire2.id,
      f.objPrice.id,
      f.mechanism.id, f.painSolved.id,
      f.persona.id, f.unspokenWant.id,
      f.proofSmiles.id, f.proofPayment.id,
    ].sort();
    expect(arch.grounded_in).toEqual(expected);
    // Unused atoms (losing clusters, fallbacks, funnel-only atoms) stay out.
    for (const unused of [f.angle, f.usp, f.desire3, f.objPain, f.proofAward, f.awareness, f.pain]) {
      expect(arch.grounded_in).not.toContain(unused.id);
    }
  });

  it('records synth_meta with atom count, avg confidence and trigger', () => {
    expect(arch.synth_meta.atom_count).toBe(17);
    expect(arch.synth_meta.trigger).toBe('manual');
    expect(arch.synth_meta.avg_confidence).toBeGreaterThan(0.5);
    expect(
      synthesizeArchitecture({ insights: allAtoms(f) }, 'atom_drift').architecture.synth_meta.trigger,
    ).toBe('atom_drift');
  });

  it('is deterministic: same insights → byte-identical output', () => {
    const a = synthesizeArchitecture({ insights: allAtoms(f) });
    const b = synthesizeArchitecture({ insights: allAtoms(f) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is stable under atom reordering', () => {
    const reversed = synthesizeArchitecture({ insights: [...allAtoms(f)].reverse() });
    expect(JSON.stringify(reversed.architecture)).toBe(JSON.stringify(arch));
  });

  it('ignores superseded/refuted atoms', () => {
    const withDead = [
      ...allAtoms(f),
      atom({ layer: 'bridge', kind: 'value_translation', confidence: 0.99, status: 'refuted', content: 'תרגום מת' }),
    ];
    const { architecture } = synthesizeArchitecture({ insights: withDead });
    expect(architecture.core_promise.insight_id).toBe(f.translation.id);
  });
});

describe('core-promise fallback chain', () => {
  it('no translation atom → falls back to the top angle atom, with a warning', () => {
    const f = dentalFixtures();
    const insights = allAtoms(f).filter((a) => a.id !== f.translation.id);
    const { architecture, warnings } = synthesizeArchitecture({ insights });
    expect(architecture.core_promise.insight_id).toBe(f.angle.id);
    expect(architecture.core_promise.text).toBe(f.angle.content);
    expect(warnings.some((w) => w.includes('No value_translation atom'))).toBe(true);
  });

  it('neither translation nor angle → real_usp, with a warning', () => {
    const f = dentalFixtures();
    const insights = allAtoms(f).filter((a) => a.id !== f.translation.id && a.id !== f.angle.id);
    const { architecture, warnings } = synthesizeArchitecture({ insights });
    expect(architecture.core_promise.insight_id).toBe(f.usp.id);
    expect(warnings.some((w) => w.includes('real_usp'))).toBe(true);
  });

  it('no promise-shaped atom at all → derived text, insight_id NULL, honest warning', () => {
    resetAtomSeq();
    const mech = atom({
      layer: 'business', kind: 'real_solution', confidence: 0.8,
      content: 'השתלות ביום אחד ללא כאב', // < 40 chars → derived text is uncut
    });
    const { architecture, warnings } = synthesizeArchitecture({ insights: [mech] });
    expect(architecture.core_promise.insight_id).toBeNull();
    expect(architecture.core_promise.text).toBe(mech.content); // < 40 chars, uncut
    expect(architecture.core_promise.confidence).toBe(0);
    expect(warnings.some((w) => w.includes('promise is weak'))).toBe(true);
  });

  it('zero atoms → typed empty result with a HARD warning, no throw', () => {
    const { architecture, warnings } = synth([]);
    expect(architecture.pillars).toEqual([]);
    expect(architecture.proof_map).toEqual([]);
    expect(architecture.grounded_in).toEqual([]);
    expect(architecture.core_promise).toEqual({ text: '', insight_id: null, confidence: 0 });
    expect(warnings.some((w) => w.startsWith('HARD:'))).toBe(true);
  });

  it('only-business atoms → promise + mechanism pillar only, with missing-pillar warnings', () => {
    const f = dentalFixtures();
    const { architecture, warnings } = synth([f.usp, f.mechanism, f.painSolved]);
    expect(architecture.core_promise.insight_id).toBe(f.usp.id);
    expect(architecture.pillars.map((p) => p.key)).toEqual([PILLAR_KEYS.mechanism]);
    expect(warnings.some((w) => w.includes('desire pillar missing'))).toBe(true);
    expect(warnings.some((w) => w.includes('objection pillar missing'))).toBe(true);
  });
});

describe('clustering', () => {
  it('same-desire atoms (matching content) form ONE pillar', () => {
    const f = dentalFixtures();
    const { architecture } = synth([f.desire1, f.desire2]);
    const desire = architecture.pillars.find((p) => p.key === PILLAR_KEYS.desire);
    expect(desire?.insight_ids).toEqual([f.desire1.id, f.desire2.id]);
  });

  it('distinct desires stay distinct clusters, ranked by summed confidence', () => {
    const f = dentalFixtures();
    const clusters = clusterByContent([f.desire3, f.desire1, f.desire2]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].anchor.id).toBe(f.desire1.id);   // sum 1.55 beats 0.60
    expect(clusters[0].members.map((m) => m.id)).toEqual([f.desire1.id, f.desire2.id]);
    expect(clusters[1].anchor.id).toBe(f.desire3.id);
  });

  it('a corroborated weaker cluster outranks a lone stronger atom (frequency is evidence)', () => {
    resetAtomSeq();
    const lone = atom({ kind: 'desire', confidence: 0.8, content: 'חניה קרובה לבית' });
    const a1 = atom({ kind: 'desire', confidence: 0.5, content: 'לחסוך זמן בבוקר עם הילדים' });
    const a2 = atom({ kind: 'desire', confidence: 0.45, content: 'לחסוך זמן בבוקר עם הילדים בדרך לגן' });
    const clusters = clusterByContent([lone, a1, a2]);
    expect(clusters[0].anchor.id).toBe(a1.id);          // sum 0.95 beats 0.80
  });
});

describe('titleFrom', () => {
  it('keeps short content whole and cuts long content at a word boundary', () => {
    expect(titleFrom('לחייך בביטחון')).toBe('לחייך בביטחון');
    const long = 'זהו תוכן ארוך מאוד של אטום שממשיך הרבה מעבר לארבעים תווים בקלות רבה';
    const title = titleFrom(long);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(41); // 40 + ellipsis
    expect(title).not.toMatch(/\s…$/);            // clean boundary, no dangling space
  });
});

describe('diffArchitectures', () => {
  const f = dentalFixtures();
  const full = synthesizeArchitecture({ insights: allAtoms(f) }).architecture;

  it('identical projections → empty diff, identical=true', () => {
    const again = synthesizeArchitecture({ insights: allAtoms(f) }).architecture;
    const diff = diffArchitectures(full, again);
    expect(diff).toEqual({
      added: [], removed: [], anchor_changed: [], core_promise_changed: false, identical: true,
    });
  });

  it('detects a removed pillar', () => {
    const without = synth(
      allAtoms(f).filter((a) => a.id !== f.persona.id && a.id !== f.unspokenWant.id),
    ).architecture;
    const diff = diffArchitectures(full, without);
    expect(diff.removed).toEqual([PILLAR_KEYS.identity]);
    expect(diff.identical).toBe(false);
  });

  it('detects an added pillar (the mirror direction)', () => {
    const without = synth(
      allAtoms(f).filter((a) => a.id !== f.persona.id && a.id !== f.unspokenWant.id),
    ).architecture;
    expect(diffArchitectures(without, full).added).toEqual([PILLAR_KEYS.identity]);
  });

  it('detects an anchor change within a surviving pillar', () => {
    // Boost desire2 above desire1: same cluster, new anchor.
    const boosted = allAtoms(f).map((a) =>
      a.id === f.desire2.id ? { ...a, confidence: 0.95 } : a,
    );
    const next = synthesizeArchitecture({ insights: boosted }).architecture;
    const diff = diffArchitectures(full, next);
    expect(diff.anchor_changed).toContain(PILLAR_KEYS.desire);
    expect(diff.identical).toBe(false);
  });

  it('detects a core-promise change', () => {
    const swapped = allAtoms(f).map((a) =>
      a.id === f.translation.id ? { ...a, content: 'שקט נפשי בכל ביס' } : a,
    );
    const next = synthesizeArchitecture({ insights: swapped }).architecture;
    expect(diffArchitectures(full, next).core_promise_changed).toBe(true);
  });
});
