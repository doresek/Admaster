// lib/strategy-objects/architecture.ts
//
// PURE synthesis of the MESSAGE ARCHITECTURE from the living atoms — C-10's
// projection logic per marketing-strategy skill §2:
//
//   CORE PROMISE  — the single top-confidence translation atom (business value
//                   → customer want). One sentence. Everything else supports it.
//   PILLARS (3–4) — desire cluster / objection pre-answered / mechanism-proof /
//                   identity-belonging (optional).
//   PROOF POINTS  — each proof atom assigned to exactly one pillar.
//                   "Unassigned proof = unused ammunition."
//
// Deliberately DETERMINISTIC, no LLM: the projection must be explainable
// atom-by-atom ("if a strategic choice can't cite an atom, it's a guess").
// Same insights → byte-identical output: every sort is stable with an id
// tie-break, and degenerate inputs are first-class typed results with
// warnings — never throws.

import type { ClientInsight } from '@/lib/intelligence/types';
import { contentMatches } from '@/lib/intelligence/lifecycle';
import type { MessageArchitectureRow, PillarSpec } from '@/lib/capability-contracts';
import type {
  ArchitectureDiff,
  ArchitectureProjection,
  SynthesisInput,
  SynthesisResult,
} from './types';

// ── constants ────────────────────────────────────────────────────────────────

/**
 * Stable pillar slugs. Deliberately CONTENT-INDEPENDENT: coverage tracking
 * (artifacts tagged pillar_ref) must survive a re-synthesis where the anchor
 * atom drifts but the pillar's ROLE (desire / objection / mechanism / identity)
 * is unchanged. The role is the stable thing; the anchor is versioned data.
 */
export const PILLAR_KEYS = {
  desire:    'desire-core',
  objection: 'objection-main',
  mechanism: 'mechanism-proof',
  identity:  'identity-belonging',
} as const;

/** Max title length before cutting at a word boundary (skill: short, scannable). */
const TITLE_MAX = 40;

/**
 * Proof-ish content patterns (Hebrew-first): atoms whose kind isn't the
 * free-form 'proof' but whose content reads as evidence (testimonials,
 * results, credentials, case studies) still belong on the proof map.
 */
const PROOF_CONTENT_PATTERN =
  /המלצ|ביקורת|תוצא|לקוחות מרוצ|מקרה בוחן|לפני ואחרי|תעוד|הסמכ|שנות ניסיון|מומח|case stud|testimonial|review|results/i;

// ── deterministic ordering helpers ───────────────────────────────────────────

/** Stable: confidence desc, then id asc — ties can never reorder between runs. */
const byConfidenceDesc = (a: ClientInsight, b: ClientInsight): number =>
  b.confidence - a.confidence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const idsByConfidence = (atoms: ClientInsight[]): string[] =>
  [...atoms].sort(byConfidenceDesc).map((a) => a.id);

/** First ~TITLE_MAX chars of the anchor's content, cut on a word boundary. */
export function titleFrom(content: string): string {
  const clean = content.trim().replace(/\s+/g, ' ');
  if (clean.length <= TITLE_MAX) return clean;
  const cut = clean.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

// ── clustering ───────────────────────────────────────────────────────────────

interface Cluster {
  anchor:  ClientInsight;
  members: ClientInsight[];
}

/**
 * Greedy deterministic clustering: walk atoms in (confidence desc, id) order;
 * an atom joins the FIRST existing cluster whose anchor it contentMatches
 * (the same fuzzy equality the lifecycle engine uses to corroborate atoms —
 * one notion of "the same belief" across the whole brain), else it seeds a
 * new cluster. Anchors are the highest-confidence member by construction.
 *
 * Clusters are ranked by summed confidence (a desire corroborated by several
 * atoms outranks a lone stronger one — frequency is evidence, per voc-mining),
 * tie-broken by anchor confidence then anchor id.
 */
export function clusterByContent(atoms: ClientInsight[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const atom of [...atoms].sort(byConfidenceDesc)) {
    const home = clusters.find((c) => contentMatches(c.anchor.content, atom.content));
    if (home) home.members.push(atom);
    else clusters.push({ anchor: atom, members: [atom] });
  }
  const sum = (c: Cluster) => c.members.reduce((s, m) => s + m.confidence, 0);
  return clusters.sort(
    (a, b) =>
      sum(b) - sum(a) ||
      b.anchor.confidence - a.anchor.confidence ||
      (a.anchor.id < b.anchor.id ? -1 : a.anchor.id > b.anchor.id ? 1 : 0),
  );
}

// ── synthesis ────────────────────────────────────────────────────────────────

const kindsOf = (
  atoms: ClientInsight[],
  layer: ClientInsight['layer'],
  kinds: readonly string[],
): ClientInsight[] => atoms.filter((a) => a.layer === layer && kinds.includes(a.kind));

/**
 * Project the active atoms into a message architecture (skill §2).
 *
 * Degenerate inputs are first-class: 0 atoms → empty pillars + hard warning;
 * only-business atoms → promise + mechanism pillar only + warnings. The
 * honest weak state is the output, never a fabricated-complete one and never
 * a throw — the caller (and the owner) must SEE what's missing.
 */
export function synthesizeArchitecture(
  input: SynthesisInput,
  trigger = 'manual',
): SynthesisResult {
  // Active atoms only — superseded/refuted beliefs never project into strategy.
  const atoms = input.insights.filter((a) => a.status === 'active').sort(byConfidenceDesc);
  const warnings: string[] = [];
  const grounded = new Set<string>();

  if (atoms.length === 0) {
    return {
      architecture: {
        core_promise: { text: '', insight_id: null, confidence: 0 },
        pillars:      [],
        proof_map:    [],
        unassigned:   [],
        grounded_in:  [],
        synth_meta:   { atom_count: 0, avg_confidence: 0, trigger },
      },
      warnings: [
        'HARD: zero active atoms — no architecture can be projected. Run the brief/intelligence pipeline first.',
      ],
    };
  }

  // ── CORE PROMISE: value_translation → angle → real_usp → derived ──────────
  // The translation atom IS the promise (business value → customer want).
  // The fallback chain degrades honestly: an angle is a promise-shaped bet,
  // a USP is business-language (not yet translated) — each step warns.
  const translation = kindsOf(atoms, 'bridge', ['value_translation'])[0];
  const angleAtom   = kindsOf(atoms, 'bridge', ['angle'])[0];
  const uspAtom     = kindsOf(atoms, 'business', ['real_usp'])[0];

  let core_promise: MessageArchitectureRow['core_promise'];
  if (translation) {
    core_promise = {
      text:       translation.content.trim(),
      insight_id: translation.id,
      confidence: translation.confidence,
    };
    grounded.add(translation.id);
  } else if (angleAtom) {
    core_promise = {
      text:       angleAtom.content.trim(),
      insight_id: angleAtom.id,
      confidence: angleAtom.confidence,
    };
    grounded.add(angleAtom.id);
    warnings.push('No value_translation atom — core promise taken from the top angle atom (a bet, not a translation).');
  } else if (uspAtom) {
    core_promise = {
      text:       uspAtom.content.trim(),
      insight_id: uspAtom.id,
      confidence: uspAtom.confidence,
    };
    grounded.add(uspAtom.id);
    warnings.push('No value_translation or angle atom — core promise taken from real_usp (business language, not customer language).');
  } else {
    // No promise-shaped atom at all: derive a placeholder from the strongest
    // business atom. insight_id null = "this text cites nothing" — the honest
    // weak state, flagged loudly.
    const topBusiness = atoms.filter((a) => a.layer === 'business')[0] ?? atoms[0];
    core_promise = {
      text:       titleFrom(topBusiness.content),
      insight_id: null,
      confidence: 0,
    };
    warnings.push('no translation atom — promise is weak (derived from the top business atom; mine VoC/brief for the value translation).');
  }

  // ── PILLARS (3–4, per skill §2 structure) ──────────────────────────────────
  const pillars: PillarSpec[] = [];

  // Pillar 1 — the main desire (top desire/aspiration/dream cluster).
  const desireAtoms = kindsOf(atoms, 'customers', ['desire', 'aspiration', 'dream']);
  const desireClusters = clusterByContent(desireAtoms);
  if (desireClusters.length > 0) {
    const c = desireClusters[0];
    pillars.push({
      key:          PILLAR_KEYS.desire,
      title:        titleFrom(c.anchor.content),
      kind_cluster: ['desire', 'aspiration', 'dream'],
      insight_ids:  idsByConfidence(c.members),
      // Awareness gradient (skill §2): the desire pillar opens the funnel —
      // story-of-the-pain for unaware, the wanted outcome for problem-aware.
      awareness_notes: 'unaware/problem-aware — סיפור הכאב והתוצאה הרצויה; לא להציג הצעה בשלב זה',
    });
    c.members.forEach((m) => grounded.add(m.id));
  } else {
    warnings.push('No desire/aspiration/dream atoms — desire pillar missing (the architecture opens nothing).');
  }

  // Pillar 2 — the main objection, pre-answered (top objection cluster).
  const objectionAtoms = kindsOf(atoms, 'customers', ['objection']);
  const objectionClusters = clusterByContent(objectionAtoms);
  if (objectionClusters.length > 0) {
    const c = objectionClusters[0];
    pillars.push({
      key:          PILLAR_KEYS.objection,
      title:        titleFrom(c.anchor.content),
      kind_cluster: ['objection'],
      insight_ids:  idsByConfidence(c.members),
      // Israeli buyers are objection-forward; this pillar earns BOFU budget.
      awareness_notes: 'product-aware/most-aware — לנטרל את ההתנגדות לפני חשיפת המחיר (BOFU)',
    });
    c.members.forEach((m) => grounded.add(m.id));
  } else {
    warnings.push('No objection atoms — objection pillar missing (the top objection is being ignored by default).');
  }

  // Pillar 3 — the mechanism / "how it actually works" (real_solution + pain_solved).
  const mechanismAtoms = kindsOf(atoms, 'business', ['real_solution', 'pain_solved']);
  if (mechanismAtoms.length > 0) {
    const sorted = [...mechanismAtoms].sort(byConfidenceDesc);
    pillars.push({
      key:          PILLAR_KEYS.mechanism,
      title:        titleFrom(sorted[0].content),
      kind_cluster: ['real_solution', 'pain_solved'],
      insight_ids:  sorted.map((a) => a.id),
      awareness_notes: 'problem-aware/solution-aware — המנגנון: איך זה באמת עובד ולמה זה שונה',
    });
    sorted.forEach((m) => grounded.add(m.id));
  } else {
    warnings.push('No real_solution/pain_solved atoms — mechanism pillar missing (nothing explains HOW it works).');
  }

  // Pillar 4 (optional) — identity/belonging. Only when atoms exist; a forced
  // fourth pillar with no atoms would be exactly the guess the skill forbids.
  const identityAtoms = kindsOf(atoms, 'customers', ['unspoken_want', 'persona']);
  if (identityAtoms.length > 0) {
    const sorted = [...identityAtoms].sort(byConfidenceDesc);
    pillars.push({
      key:          PILLAR_KEYS.identity,
      title:        titleFrom(sorted[0].content),
      kind_cluster: ['unspoken_want', 'persona'],
      insight_ids:  sorted.map((a) => a.id),
      awareness_notes: 'כל הרמות — שייכות וזהות; מחזק כל פילר אחר, לא עומד לבד',
    });
    sorted.forEach((m) => grounded.add(m.id));
  }

  // ── PROOF MAP: every proof atom → its best pillar (skill §2: exactly one) ──
  const proofAtoms = atoms.filter(
    (a) =>
      a.layer === 'business' &&
      (a.kind === 'proof' || (PROOF_CONTENT_PATTERN.test(a.content) && !grounded.has(a.id))),
  );

  const proof_map: MessageArchitectureRow['proof_map'] = [];
  const unassigned: MessageArchitectureRow['unassigned'] = [];
  for (const proof of [...proofAtoms].sort(byConfidenceDesc)) {
    if (grounded.has(proof.id)) continue; // already a pillar member (e.g. real_solution)
    const pillarKey = bestPillarFor(proof, pillars, atoms);
    if (pillarKey) {
      proof_map.push({ proof_insight_id: proof.id, pillar_key: pillarKey });
      grounded.add(proof.id);
    } else {
      // The skill's "unused ammunition" flag: proof exists but supports no
      // pillar — surface it instead of forcing a wrong assignment.
      unassigned.push({
        proof_insight_id: proof.id,
        reason: 'no content match with any pillar\'s atoms — unused ammunition',
      });
      warnings.push(`Proof atom ${proof.id} unassigned — unused ammunition.`);
    }
  }

  const avg =
    atoms.reduce((s, a) => s + a.confidence, 0) / atoms.length;

  return {
    architecture: {
      core_promise,
      pillars,
      proof_map,
      unassigned,
      grounded_in: [...grounded].sort(),
      synth_meta: {
        atom_count:     atoms.length,
        avg_confidence: Math.round(avg * 10000) / 10000,
        trigger,
      },
    },
    warnings,
  };
}

/**
 * Assign a proof atom to the pillar whose member atoms it matches most
 * (contentMatches count at the lifecycle threshold, then a looser 0.25 pass
 * as tie-breaker; final tie → pillar order, i.e. desire first — the skill's
 * pillar ordering is also its priority ordering). Returns null when the proof
 * matches nothing anywhere.
 */
function bestPillarFor(
  proof: ClientInsight,
  pillars: PillarSpec[],
  atoms: ClientInsight[],
): string | null {
  const byId = new Map(atoms.map((a) => [a.id, a]));
  let best: { key: string; strict: number; loose: number } | null = null;

  for (const pillar of pillars) {
    let strict = 0;
    let loose = 0;
    for (const id of pillar.insight_ids) {
      const member = byId.get(id);
      if (!member) continue;
      if (contentMatches(proof.content, member.content)) strict++;
      if (contentMatches(proof.content, member.content, 0.25)) loose++;
    }
    if (strict === 0 && loose === 0) continue;
    if (!best || strict > best.strict || (strict === best.strict && loose > best.loose)) {
      best = { key: pillar.key, strict, loose };
    }
  }
  return best?.key ?? null;
}

// ── diff ─────────────────────────────────────────────────────────────────────

/** Canonical serialization of the identity slice — synth_meta excluded (types.ts). */
const projectionOf = (a: ArchitectureProjection): string =>
  JSON.stringify({
    core_promise: a.core_promise,
    pillars:      a.pillars,
    proof_map:    a.proof_map,
    unassigned:   a.unassigned,
  });

/**
 * Structural diff between two architectures — feeds the "should we save a new
 * version" decision (identical → skip, no version churn) and the changelog.
 * The anchor of a pillar is its top insight_id (insight_ids are confidence-
 * sorted by construction).
 */
export function diffArchitectures(
  prev: ArchitectureProjection,
  next: ArchitectureProjection,
): ArchitectureDiff {
  const prevKeys = new Map(prev.pillars.map((p) => [p.key, p]));
  const nextKeys = new Map(next.pillars.map((p) => [p.key, p]));

  const added   = [...nextKeys.keys()].filter((k) => !prevKeys.has(k));
  const removed = [...prevKeys.keys()].filter((k) => !nextKeys.has(k));
  const anchor_changed = [...nextKeys.keys()].filter((k) => {
    const p = prevKeys.get(k);
    return p !== undefined && p.insight_ids[0] !== nextKeys.get(k)?.insight_ids[0];
  });

  const core_promise_changed =
    prev.core_promise.text !== next.core_promise.text ||
    prev.core_promise.insight_id !== next.core_promise.insight_id;

  return {
    added,
    removed,
    anchor_changed,
    core_promise_changed,
    identical: projectionOf(prev) === projectionOf(next),
  };
}
