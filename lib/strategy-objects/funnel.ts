// lib/strategy-objects/funnel.ts
//
// PURE funnel design + health — C-10's funnel-as-object per marketing-strategy
// skill §4: "a funnel is nodes and edges with expected conversion per edge —
// not TOFU/MOFU/BOFU vibes."
//
//   designFunnel — walks BACKWARDS from the sale (§4.1: what must the buyer
//     believe at purchase? which belief does each node install?). Funnel
//     LENGTH = awareness distance (§4.2), never budget. Every edge gets an
//     expected rate with provenance (client baseline > declared guess >
//     playbook prior) so diagnosis can be honest about what "expected" means.
//
//   funnelHealth — per-edge actual/expected ratio; the worst SUFFICIENT edge
//     is the diagnosis engine's localization input (§4.3: "never redesign the
//     whole funnel when one edge is broken"). Edges under the sample floor are
//     unreadable — do not diagnose.
//
// Deterministic, no LLM, no I/O. Degenerate inputs → typed results with
// warnings, never throws.

import type { ClientInsight } from '@/lib/intelligence/types';
import type { FunnelStage } from '@/lib/decision-engine/types';
import type { FunnelEdge, FunnelNode, FunnelRow } from '@/lib/capability-contracts';
import type {
  EdgeHealth,
  FunnelDesignInput,
  FunnelDesignResult,
  FunnelHealth,
  RateSample,
} from './types';

// ── constants ────────────────────────────────────────────────────────────────

/**
 * Minimum sample per edge before its actual rate is readable. Below this the
 * edge is "unreadable — do not diagnose" (creative-testing floor discipline
 * applied to funnel edges): a terrible ratio on n=5 is noise, not a diagnosis.
 */
export const MIN_EDGE_N = 30;

/**
 * DEFAULT_PRIORS — honest IL-SMB per-event defaults (band MIDPOINTS).
 *
 * These are PRIORS, NOT LAWS: fleet-generic starting expectations used only
 * until a client baseline (n≥30) exists. Each number is the midpoint of the
 * band we consider defensible for Israeli SMB service businesses on Meta;
 * they exist so an expected rate always has a stated origin ('playbook_prior')
 * instead of a silent invented number. C-12 (live vertical benchmarks) will
 * eventually replace these with measured fleet values.
 */
export const DEFAULT_PRIORS: Record<string, number> = {
  // Content post/video view → meaningful engagement that enters the
  // retargeting pool. IL SMB organic/boosted engagement band ~3–7%.
  content_engaged: 0.05,
  // Warm retargeting-ad CTR. Warm beats cold but stays ad-shaped: ~0.9–1.5%.
  retargeting_click: 0.012,
  // Cold Meta feed CTR (link click / impression), IL SMB band ~0.9–1.5%.
  ad_click: 0.012,
  // Landing view → lead submitted. The spec's canonical example band 3–8%.
  landing_lead: 0.055,
  // Lead → engages with the WhatsApp sequence (replies/clicks). WhatsApp is
  // the Israeli BOFU edge (skill §4.4); reply bands run high: ~45–65%.
  whatsapp_engaged: 0.55,
  // Raw lead → sale with NO nurture, IL SMB services ~8–15%.
  lead_to_sale: 0.12,
  // WhatsApp-nurtured lead → sale; nurture lifts close rates: ~12–25%.
  whatsapp_to_sale: 0.18,
};

/** Canonical Schwartz keys, ordered far→near (mirrors decide.ts vocabulary). */
export type AwarenessKey =
  | 'unaware' | 'problem-aware' | 'solution-aware' | 'product-aware' | 'most-aware';

/**
 * Normalize a free-text awareness value to a canonical Schwartz key. The
 * SAME vocabulary as lib/decision-engine/decide.ts resolveAwarenessKey —
 * mirrored (not imported) per the shared-file law; decide.ts is engine
 * internals, only its types are a contract.
 */
export function resolveAwareness(text: string | undefined): AwarenessKey | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/most[\s-]*aware|הכי מודע|מודע ביותר/.test(t)) return 'most-aware';
  if (/product[\s-]*aware|מודע למוצר/.test(t)) return 'product-aware';
  if (/solution[\s-]*aware|מודע לפתרון/.test(t)) return 'solution-aware';
  if (/problem[\s-]*aware|מודע לבעיה/.test(t)) return 'problem-aware';
  if (/unaware|לא מודע|חוסר מודעות/.test(t)) return 'unaware';
  return undefined;
}

/**
 * Funnel-stage fallback when no awareness signal exists at all. Inverts the
 * decide.ts AWARENESS_TO_FUNNEL mapping to the SHORTEST honest interpretation
 * of each stage (BOFU implies at least product-aware; TOFU without evidence of
 * "unaware" defaults to problem-aware — a maximal-length funnel needs positive
 * evidence of an unaware audience, not the absence of evidence).
 */
const STAGE_TO_AWARENESS: Record<FunnelStage, AwarenessKey> = {
  TOFU: 'problem-aware',
  MOFU: 'solution-aware',
  BOFU: 'product-aware',
};

// ── design ───────────────────────────────────────────────────────────────────

const byConfidenceDesc = (a: ClientInsight, b: ClientInsight): number =>
  b.confidence - a.confidence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const topOf = (
  insights: ClientInsight[],
  layer: ClientInsight['layer'],
  kinds: readonly string[],
): ClientInsight | undefined =>
  insights
    .filter((a) => a.status === 'active' && a.layer === layer && kinds.includes(a.kind))
    .sort(byConfidenceDesc)[0];

/**
 * Design the funnel object for one marketing decision.
 *
 * Built by WALKING BACKWARDS from the sale (skill §4.1) — the belief chain:
 *   sale ⟵ "the offer beats my alternative"      (objection atoms)
 *        ⟵ lead/whatsapp
 *        ⟵ "these people can fix MY problem"     (proof / real_solution atoms)
 *        ⟵ landing
 *        ⟵ "this speaks about me"                (desire / pain atoms — the angle)
 *        ⟵ ad
 * The code assembles front-to-back for readability, but every node's belief is
 * justified by what the NEXT node needs — a node that installs no belief is a
 * leak, so a node with no citing atom carries a warning.
 *
 * Funnel LENGTH = awareness distance (§4.2):
 *   most/product-aware → ad → landing → lead → sale                  (short)
 *   solution/problem-aware → + whatsapp_sequence nurture             (medium)
 *   unaware → + content + retargeting in front                       (long)
 */
export function designFunnel(input: FunnelDesignInput): FunnelDesignResult {
  const warnings: string[] = [];
  const grounded = new Set<string>();
  const insights = input.insights ?? [];

  // Awareness: explicit decision value → the client's awareness atom →
  // funnel-stage fallback (each step further from evidence, each step warned).
  const awarenessAtom = topOf(insights, 'customers', ['awareness']);
  let awareness =
    resolveAwareness(input.decision.awareness) ?? resolveAwareness(awarenessAtom?.content);
  if (awareness === undefined) {
    awareness = STAGE_TO_AWARENESS[input.decision.funnel_stage];
    warnings.push(
      `No awareness signal — derived "${awareness}" from funnel_stage ${input.decision.funnel_stage} (shortest honest interpretation).`,
    );
  } else if (!resolveAwareness(input.decision.awareness) && awarenessAtom) {
    grounded.add(awarenessAtom.id);
  }

  // The atoms each belief cites (walking the chain above).
  const desireAtom    = pickAngleBelief(insights, input.decision.angle);
  const proofAtom     = topOf(insights, 'business', ['real_solution', 'pain_solved', 'proof']);
  const objectionAtom = topOf(insights, 'customers', ['objection']);
  const painAtom      = topOf(insights, 'customers', ['pain']);

  const belief = (
    text: string,
    atom: ClientInsight | undefined,
    missing: string,
  ): FunnelNode['belief_installed'] => {
    if (atom) {
      grounded.add(atom.id);
      return { insight_id: atom.id, text };
    }
    warnings.push(`${missing} — belief is text-only (uncited = a guess to validate).`);
    return { text };
  };

  const nodes: FunnelNode[] = [];
  const edges: FunnelEdge[] = [];
  const expect = (event: string): FunnelEdge['expected'] =>
    resolveExpectedRate(event, input.baselines, input.overrides, warnings);
  const link = (from: string, to: string, event: string): void => {
    edges.push({ from, to, event, expected: expect(event) });
  };

  const long   = awareness === 'unaware';
  const medium = awareness === 'problem-aware' || awareness === 'solution-aware';

  if (long) {
    // Unaware: the ad cannot open with an offer — content installs "I have a
    // problem worth attention", retargeting re-finds the engaged (§4.2).
    nodes.push({
      key:  'content',
      kind: 'content',
      belief_installed: belief(
        'יש לי בעיה ששווה תשומת לב — סיפור הכאב',
        painAtom,
        'No pain atom for the unaware content node',
      ),
    });
    nodes.push({
      key:  'retargeting',
      kind: 'retargeting',
      belief_installed: belief(
        'הבעיה הזאת רלוונטית אליי ואני מזהה את מי שמדבר עליה',
        desireAtom ?? painAtom,
        'No desire/pain atom for the retargeting node',
      ),
    });
    link('content', 'retargeting', 'content_engaged');
    link('retargeting', 'ad', 'retargeting_click');
  }

  // ad → installs "this speaks about me" (the angle expressed as a desire/pain).
  nodes.push({
    key:  'ad',
    kind: 'ad',
    belief_installed: belief(
      'זה מדבר עליי — הכאב/הרצון שלי בדיוק',
      desireAtom,
      'No desire/pain atom matching the angle',
    ),
  });
  // landing → installs "these people can fix MY problem" (proof/mechanism).
  nodes.push({
    key:  'landing',
    kind: 'landing',
    belief_installed: belief(
      'האנשים האלה יכולים לפתור את הבעיה שלי — הנה איך והנה הוכחה',
      proofAtom,
      'No real_solution/pain_solved/proof atom for the landing node',
    ),
  });
  link('ad', 'landing', 'ad_click');

  if (medium || long) {
    // Nurture path: lead_form commits contact; the WhatsApp sequence (the
    // Israeli BOFU edge, §4.4) pre-answers the top objection before the sale.
    nodes.push({
      key:  'lead_form',
      kind: 'lead_form',
      belief_installed: belief(
        'שווה להשאיר פרטים — בלי סיכון ובלי התחייבות',
        proofAtom,
        'No proof atom for the lead_form node',
      ),
    });
    nodes.push({
      key:  'whatsapp_sequence',
      kind: 'whatsapp_sequence',
      belief_installed: belief(
        'ההצעה הזאת עדיפה על האלטרנטיבה שלי — ההתנגדות המרכזית קיבלה מענה',
        objectionAtom,
        'No objection atom for the WhatsApp nurture node',
      ),
    });
    link('landing', 'lead_form', 'landing_lead');
    link('lead_form', 'whatsapp_sequence', 'whatsapp_engaged');
    nodes.push(saleNode());
    link('whatsapp_sequence', 'sale', 'whatsapp_to_sale');
  } else {
    // Short (product/most-aware): the audience already believes; the lead node
    // itself carries the offer-beats-alternative belief straight into the sale.
    nodes.push({
      key:  'lead_form',
      kind: 'lead_form',
      belief_installed: belief(
        'ההצעה עדיפה על האלטרנטיבה שלי — ההתנגדות המרכזית קיבלה מענה',
        objectionAtom,
        'No objection atom for the lead_form node',
      ),
    });
    link('landing', 'lead_form', 'landing_lead');
    nodes.push(saleNode());
    link('lead_form', 'sale', 'lead_to_sale');
  }

  return {
    funnel: {
      name:            `משפך ${awareness} — ${titleSlice(input.decision.angle)}`,
      awareness_entry: awareness,
      nodes,
      edges,
      grounded_in: [...grounded].sort(),
    },
    warnings,
  };
}

/** Terminal node: the purchase itself — the belief chain's destination. */
const saleNode = (): FunnelNode => ({
  key:  'sale',
  kind: 'sale',
  belief_installed: { text: 'הערך עולה על המחיר ועל האלטרנטיבה — קונים' },
});

const titleSlice = (s: string): string => {
  const clean = s.trim().replace(/\s+/g, ' ');
  return clean.length <= 30 ? clean : `${clean.slice(0, 30).trim()}…`;
};

/**
 * The ad's belief cites the atom the ANGLE actually expresses: the
 * highest-confidence desire/pain whose content fuzzy-matches the angle text
 * (ad→landing scent starts at the atom level, §4.5); when none matches, fall
 * back to the top desire/pain outright.
 */
function pickAngleBelief(
  insights: ClientInsight[],
  angle: string,
): ClientInsight | undefined {
  const candidates = insights
    .filter(
      (a) =>
        a.status === 'active' &&
        a.layer === 'customers' &&
        ['desire', 'aspiration', 'dream', 'pain'].includes(a.kind),
    )
    .sort(byConfidenceDesc);
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const angleTokens = new Set(norm(angle).split(/\s+/).filter(Boolean));
  const matching = candidates.find((a) =>
    norm(a.content).split(/\s+/).some((t) => t.length > 1 && angleTokens.has(t)),
  );
  return matching ?? candidates[0];
}

/**
 * Expected-rate resolution with provenance (skill §4.3 ordering, adapted):
 *   1. client baseline with n≥MIN_EDGE_N  → 'client_baseline' (real data wins)
 *   2. caller-declared override            → 'declared_guess'  (deliberate,
 *      funnel-specific human judgment — labeled a guess so diagnosis stays honest)
 *   3. DEFAULT_PRIORS                      → 'playbook_prior'  (fleet-generic)
 * A baseline under the floor is noise, not a baseline — noted and skipped.
 */
function resolveExpectedRate(
  event: string,
  baselines: Record<string, RateSample> | undefined,
  overrides: Record<string, number> | undefined,
  warnings: string[],
): FunnelEdge['expected'] {
  const baseline = baselines?.[event];
  if (baseline && baseline.n >= MIN_EDGE_N && Number.isFinite(baseline.rate)) {
    return { rate: baseline.rate, provenance: 'client_baseline' };
  }
  if (baseline && baseline.n < MIN_EDGE_N) {
    warnings.push(
      `Baseline for "${event}" has n=${baseline.n} < ${MIN_EDGE_N} — ignored (noise, not a baseline).`,
    );
  }
  const override = overrides?.[event];
  if (override !== undefined && Number.isFinite(override)) {
    return { rate: override, provenance: 'declared_guess' };
  }
  const prior = DEFAULT_PRIORS[event];
  if (prior !== undefined) return { rate: prior, provenance: 'playbook_prior' };
  // Unreachable for the canonical node set (every event has a prior), but the
  // function stays total: an unknown event is an explicit zero-confidence guess.
  warnings.push(`No prior for event "${event}" — expected rate is a blind guess (0).`);
  return { rate: 0, provenance: 'declared_guess' };
}

// ── health ───────────────────────────────────────────────────────────────────

/**
 * Localize funnel failure to the edge whose actual/expected ratio is worst —
 * among SUFFICIENT edges only. An edge with n < MIN_EDGE_N is unreadable:
 * it appears in the report (with its ratio, for transparency) but can never
 * be blamed. When NO edge is sufficient the whole funnel is unreadable —
 * worst_edge null + reason, and the diagnosis engine must not diagnose.
 */
export function funnelHealth(
  funnel: Pick<FunnelRow, 'edges'>,
  actuals: Record<string, RateSample>,
): FunnelHealth {
  const edges: EdgeHealth[] = funnel.edges.map((edge) => {
    // Live actuals win; a stale actual persisted on the edge is the fallback.
    const actual = actuals[edge.event] ?? edge.actual ?? null;
    const ratio =
      actual && edge.expected.rate > 0 && Number.isFinite(actual.rate)
        ? actual.rate / edge.expected.rate
        : null;
    return {
      from:         edge.from,
      to:           edge.to,
      event:        edge.event,
      expected:     edge.expected,
      actual,
      ratio,
      sufficient_n: actual !== null && actual.n >= MIN_EDGE_N,
    };
  });

  // Collect readable edges with a narrowed (non-null) ratio so the min-fold
  // below needs no assertion.
  const readable: Array<{ edge: EdgeHealth; ratio: number }> = [];
  for (const e of edges) {
    if (e.sufficient_n && e.ratio !== null) readable.push({ edge: e, ratio: e.ratio });
  }
  if (readable.length === 0) {
    return {
      worst_edge: null,
      reason: `no edge has sufficient sample (n≥${MIN_EDGE_N}) — funnel unreadable, do not diagnose`,
      edges,
    };
  }

  const worst = readable.reduce((w, e) => (e.ratio < w.ratio ? e : w));
  return { worst_edge: worst.edge, edges };
}
