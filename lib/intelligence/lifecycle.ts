// lib/intelligence/lifecycle.ts
//
// The lifecycle ENGINE: a pure confidence policy (`reduceSignal`,
// `contentMatches`) plus the apply paths that persist its decisions
// (`reconcileCandidates` for brief re-analysis, `applyLearningSignal` for the
// Part-2 content-performance / user-signal loop).
//
// Confidence accumulation (§9 — constants live in ./types CONFIDENCE):
//   • start 0.50
//   • corroborate: confidence = min(0.99, c + 0.12*weight), evidence_count++
//   • weaken:      confidence = max(0.05, c - 0.12*weight)
//   • DECISIVE contradiction (weight>=0.70 negative, OR confidence would fall
//     below 0.15) -> action 'supersede' (the apply path supersedes/refutes;
//     atoms are NEVER deleted).
//
// Pure functions are unit-tested in isolation; the apply paths use the
// service-role admin client and write an insight_events row for every mutation.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CONFIDENCE,
  SINGLETON_KINDS,
  type ClientInsight,
  type InsightCandidate,
  type InsightSource,
  type LearningSignal,
} from './types';
import {
  createInsight,
  listActiveInsights,
  logInsightEvent,
  supersedeInsight,
  updateInsightConfidence,
} from './insights';

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export interface SignalReduction {
  confidence:     number;
  evidence_count: number;
  action:         'corroborate' | 'weaken' | 'supersede';
}

/**
 * PURE policy: given an atom's current state and a learning signal, compute the
 * next confidence / evidence_count and the action to take. No I/O. The apply
 * paths below turn the action into persisted mutations + audit events.
 */
export function reduceSignal(
  insight: Pick<ClientInsight, 'confidence' | 'evidence_count'>,
  signal:  Pick<LearningSignal, 'polarity' | 'weight'>,
): SignalReduction {
  const c  = clamp(Number.isFinite(insight.confidence) ? insight.confidence : CONFIDENCE.START, CONFIDENCE.MIN, CONFIDENCE.MAX);
  const ec = Number.isFinite(insight.evidence_count) ? insight.evidence_count : 0;
  const w  = clamp(Number.isFinite(signal.weight) ? signal.weight : 0, 0, 1);

  if (signal.polarity === 'positive') {
    return {
      confidence:     round4(Math.min(CONFIDENCE.MAX, c + CONFIDENCE.STEP * w)),
      evidence_count: ec + 1,
      action:         'corroborate',
    };
  }

  // negative
  const raw      = c - CONFIDENCE.STEP * w;
  const decisive = w >= CONFIDENCE.DECISIVE_WEIGHT || raw < CONFIDENCE.SUPERSEDE_FLOOR;
  return {
    confidence:     round4(Math.max(CONFIDENCE.MIN, raw)),
    evidence_count: ec,
    action:         decisive ? 'supersede' : 'weaken',
  };
}

/**
 * PURE fuzzy content match. Two atoms "agree" when their normalized content is
 * equal, one contains the other, or their word-token Jaccard meets `threshold`.
 * Unicode-aware so Hebrew tokenizes correctly.
 */
export function contentMatches(a: string, b: string, threshold = 0.5): boolean {
  const norm = (s: string) =>
    (s ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return false;

  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && inter / union >= threshold;
}

// ── apply paths (service-role admin client) ────────────────────────────────────

export interface ReconcileResult {
  created:      number;
  corroborated: number;
  superseded:   number;
}

export interface ReconcileOptions {
  source?:    InsightSource;
  sourceRef?: Record<string, unknown> | null;
}

/**
 * Reconcile freshly-analyzed candidates against the client's active atoms:
 *   • match (same layer+kind, fuzzy content) & agrees  -> corroborate (+event)
 *   • singleton-slot, decisive contradiction (different content, confidence
 *     >= DECISIVE_WEIGHT) -> create the corrected atom, supersede the old (+events)
 *   • no match -> create a new atom (+ 'created' event)
 * NEVER deletes. Returns counts for observability.
 */
export async function reconcileCandidates(
  admin:       SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  candidates:  InsightCandidate[],
  opts:        ReconcileOptions = {},
): Promise<ReconcileResult> {
  const source    = opts.source ?? 'brief';
  const sourceRef = opts.sourceRef ?? null;
  const res: ReconcileResult = { created: 0, corroborated: 0, superseded: 0 };

  // Local mutable view of the active atoms so successive candidates of the same
  // kind reconcile against the freshest state without a re-fetch per candidate.
  const active = await listActiveInsights(admin, clientId);

  for (const c of candidates) {
    if (!c.content?.trim()) continue;

    const sameKind = active.filter(
      (a) => a.status === 'active' && a.layer === c.layer && a.kind === c.kind,
    );
    const match = sameKind.find((a) => contentMatches(a.content, c.content));

    // (1) Agrees with an existing atom -> corroborate it.
    if (match) {
      const reduction = reduceSignal(match, { polarity: 'positive', weight: c.confidence });
      await updateInsightConfidence(admin, match.id, {
        confidence:    reduction.confidence,
        evidenceCount: reduction.evidence_count,
      });
      await logInsightEvent(admin, {
        insightId:       match.id,
        clientId:        match.client_id,
        ownerUserId:     match.owner_user_id,
        event:           'corroborated',
        deltaConfidence: round4(reduction.confidence - match.confidence),
        reason:          c.rationale || `corroborated from ${source}`,
      });
      match.confidence     = reduction.confidence;
      match.evidence_count = reduction.evidence_count;
      res.corroborated++;
      continue;
    }

    // (2) Decisive contradiction in a singleton slot -> create corrected, supersede old.
    if (SINGLETON_KINDS.has(c.kind) && sameKind.length > 0 && c.confidence >= CONFIDENCE.DECISIVE_WEIGHT) {
      const corrected = await createInsight(admin, {
        clientId, ownerUserId,
        layer:      c.layer,
        kind:       c.kind,
        content:    c.content,
        structured: c.rationale ? { rationale: c.rationale } : null,
        source,
        sourceRef,
        confidence: c.confidence,
      });
      // Supersede the strongest stale atom in the slot.
      const old = [...sameKind].sort((a, b) => b.confidence - a.confidence)[0];
      await supersedeInsight(
        admin,
        old.id,
        corrected.id,
        `superseded by updated ${c.kind}${c.rationale ? `: ${c.rationale}` : ''}`.slice(0, 500),
      );
      old.status = 'superseded';
      active.push(corrected);
      res.created++;
      res.superseded++;
      continue;
    }

    // (3) No match -> brand new atom.
    const created = await createInsight(admin, {
      clientId, ownerUserId,
      layer:      c.layer,
      kind:       c.kind,
      content:    c.content,
      structured: c.rationale ? { rationale: c.rationale } : null,
      source,
      sourceRef,
      confidence: c.confidence,
    });
    active.push(created);
    res.created++;
  }

  return res;
}

/**
 * Apply a single LearningSignal to one atom (the Part-2 entry point for the
 * content-performance / user-signal loop). Corroborates, weakens, or — on a
 * decisive negative — REFUTES the atom (status 'refuted'; never deleted).
 * Returns the updated atom, or null when it was refuted.
 */
export async function applyLearningSignal(
  admin:   SupabaseClient,
  insight: ClientInsight,
  signal:  LearningSignal,
): Promise<ClientInsight | null> {
  const reduction = reduceSignal(insight, signal);
  const delta = round4(reduction.confidence - insight.confidence);

  if (reduction.action === 'supersede') {
    await updateInsightConfidence(admin, insight.id, {
      confidence:    reduction.confidence,
      evidenceCount: reduction.evidence_count,
      status:        'refuted',
    });
    await logInsightEvent(admin, {
      insightId:       insight.id,
      clientId:        insight.client_id,
      ownerUserId:     insight.owner_user_id,
      event:           'refuted',
      deltaConfidence: delta,
      signalId:        signal.signalId,
      reason:          signal.reason,
    });
    return null;
  }

  await updateInsightConfidence(admin, insight.id, {
    confidence:    reduction.confidence,
    evidenceCount: reduction.evidence_count,
  });
  await logInsightEvent(admin, {
    insightId:       insight.id,
    clientId:        insight.client_id,
    ownerUserId:     insight.owner_user_id,
    event:           reduction.action === 'corroborate' ? 'corroborated' : 'weakened',
    deltaConfidence: delta,
    signalId:        signal.signalId,
    reason:          signal.reason,
  });

  return { ...insight, confidence: reduction.confidence, evidence_count: reduction.evidence_count };
}
