// lib/episodic/compose.ts
//
// PURE episode composition — the intelligence of C-02. Turns a resolved unit
// of experience (a diagnoses row, a resolved hypotheses row) into the canonical
// "Situation → Action → Outcome → Lesson" text that gets embedded, and into a
// fleet-safe abstraction of that text.
//
// Everything here is deterministic (no LLM, no DB, no clock): the same source
// row always renders the same episode, so re-ingestion is idempotent and the
// embeddings stay stable. The rendering is modeled on the worked example in
// .claude/skills/diagnosis-reasoning/SKILL.md §6 — a compressed causal
// narrative, not a metrics dump.
import type { EpisodeOutcome } from '@/lib/capability-contracts';
import { stripEmails, stripPhones, stripTerm, stripUrls } from '@/lib/pii';
import {
  isRecord,
  type AbstractionOptions,
  type ComposedEpisode,
  type DiagnosisSourceRow,
  type EpisodeSource,
  type HypothesisEpisodeSource,
} from './types';

/** Thrown when a source row is too malformed to render a truthful episode. */
export class EpisodeCompositionError extends Error {
  readonly sourceKind: string;
  readonly sourceId:   string;

  constructor(sourceKind: string, sourceId: string, reason: string) {
    super(`[episodic] cannot compose ${sourceKind} ${sourceId || '<no id>'}: ${reason}`);
    this.name = 'EpisodeCompositionError';
    this.sourceKind = sourceKind;
    this.sourceId = sourceId;
  }
}

/** Hypothesis statuses that count as "resolved experience" (episode-worthy). */
export const RESOLVED_HYPOTHESIS_STATUSES = ['supported', 'refuted', 'inconclusive', 'killed'] as const;

const RESOLVED_SET: ReadonlySet<string> = new Set(RESOLVED_HYPOTHESIS_STATUSES);

// ── Rendering helpers ─────────────────────────────────────────────────────────

/** Collapse to one line and hard-cap length so no field can flood the episode. */
function essence(text: string, max = 240): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** JSON.stringify with sorted keys — deterministic across row re-reads. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    const body = Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Pull a string field out of a jsonb record, if present and non-empty. */
function stringField(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const v = record[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Render up to 6 numeric metrics from evidence.metrics, sorted for determinism. */
function renderMetrics(evidence: Record<string, unknown> | null): string | null {
  if (!evidence) return null;
  const metrics = evidence.metrics;
  if (!isRecord(metrics)) return null;
  const pairs = Object.entries(metrics)
    .filter((entry): entry is [string, number] =>
      typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 6)
    .map(([k, v]) => `${k}=${v}`);
  return pairs.length ? pairs.join(', ') : null;
}

/** Compact essence of a recommended_action jsonb (prefer its own summary text). */
function renderAction(action: Record<string, unknown> | null): string | null {
  if (!action || Object.keys(action).length === 0) return null;
  const summary =
    stringField(action, 'summary') ?? stringField(action, 'action') ?? stringField(action, 'type');
  return summary ? essence(summary, 160) : essence(stableStringify(action), 160);
}

// ── Diagnosis episodes ────────────────────────────────────────────────────────

/** Situation context the caller may add when it is not present in evidence. */
export interface DiagnosisComposeContext {
  vertical?:    string | null;
  funnelStage?: string | null;
  angle?:       string | null;
}

/**
 * Render a diagnoses row (migration 030) as an episode. WHY this shape: the
 * lesson a future decision needs from a diagnosis is "which LINK broke and
 * why" — so the failed_link + rationale essence IS the lesson, and the
 * situation carries the funnel stage / angle so similar situations embed
 * close together. Evidence jsonb wins over caller-supplied context (it was
 * recorded at diagnosis time); context only fills gaps.
 */
export function composeFromDiagnosis(
  row: DiagnosisSourceRow,
  context: DiagnosisComposeContext = {},
): ComposedEpisode {
  if (!row.id) throw new EpisodeCompositionError('diagnosis', row.id, 'missing id');
  if (typeof row.rationale !== 'string' || !row.rationale.trim()) {
    throw new EpisodeCompositionError('diagnosis', row.id, 'empty rationale');
  }
  if (typeof row.failed_link !== 'string' || !row.failed_link.trim()) {
    throw new EpisodeCompositionError('diagnosis', row.id, 'missing failed_link');
  }

  const evidence    = isRecord(row.evidence) ? row.evidence : null;
  const funnelStage = stringField(evidence, 'funnel_stage') ?? (context.funnelStage?.trim() || null);
  const angle       = stringField(evidence, 'angle')        ?? (context.angle?.trim() || null);
  const vertical    = stringField(evidence, 'vertical')     ?? (context.vertical?.trim() || null);
  const metrics     = renderMetrics(evidence);
  const action      = renderAction(isRecord(row.recommended_action) ? row.recommended_action : null);

  const situationBits = [
    vertical    ? `vertical: ${vertical}`        : null,
    funnelStage ? `funnel stage ${funnelStage}`  : null,
    angle       ? `angle "${essence(angle, 80)}"` : null,
    metrics     ? `metrics: ${metrics}`          : null,
  ].filter((bit): bit is string => bit !== null);
  const situation = situationBits.length
    ? `campaign item underperformed — ${situationBits.join('; ')}.`
    : 'campaign item underperformed.';

  const outcome = outcomeOf({ kind: 'diagnosis', row });
  const noFailure = row.failed_link === 'none';
  const outcomeLine = noFailure
    ? 'no failing link found (execution intact).'
    : `failed link = ${row.failed_link}.`;
  const lesson = noFailure
    ? `no link failure — ${essence(row.rationale)}`
    : `${row.failed_link} link broke — ${essence(row.rationale)}`;

  const episodeText = [
    `Situation: ${situation}`,
    `Action: ran link-isolation diagnosis over the client's insight atoms${action ? `; recommended: ${action}` : ''}.`,
    `Outcome: ${outcomeLine}`,
    `Lesson: ${lesson}`,
  ].join('\n');

  return {
    source_kind:  'diagnosis',
    source_id:    row.id,
    episode_text: episodeText,
    outcome,
    insight_ids:  Array.isArray(row.target_insight_ids) ? row.target_insight_ids : [],
    metadata: {
      failed_link: row.failed_link,
      applied:     row.applied === true,
      ...(funnelStage ? { funnel_stage: funnelStage } : {}),
      ...(angle       ? { angle } : {}),
      ...(vertical    ? { vertical } : {}),
    },
  };
}

// ── Hypothesis episodes ───────────────────────────────────────────────────────

/**
 * Render a RESOLVED hypotheses row (migration 034) as an episode. Only
 * resolved statuses are episode-worthy — an open hypothesis is a bet, not
 * experience — so anything else throws. The lesson is the verdict applied to
 * the claim ("supported: <claim>"), which is exactly what a future decision
 * wants recalled.
 */
export function composeFromHypothesis(row: HypothesisEpisodeSource): ComposedEpisode {
  if (!row.id) throw new EpisodeCompositionError('hypothesis', row.id, 'missing id');
  if (!RESOLVED_SET.has(row.status)) {
    throw new EpisodeCompositionError('hypothesis', row.id, `status "${row.status}" is not resolved`);
  }
  if (typeof row.claim !== 'string' || !row.claim.trim()) {
    throw new EpisodeCompositionError('hypothesis', row.id, 'empty claim');
  }
  if (!isRecord(row.prediction)) {
    throw new EpisodeCompositionError('hypothesis', row.id, 'missing prediction');
  }

  const p = row.prediction;
  const baseline = typeof p.baseline_arm === 'string' && p.baseline_arm
    ? ` (vs "${p.baseline_arm}")` : '';
  const prediction =
    `${p.metric} ${p.comparator} ${p.value} on arm "${p.arm}"${baseline} @confidence ${p.confidence}`;

  const resolution = row.resolution;
  const resolvedBy = resolution?.resolved_by ?? null;
  const observed   = resolution && isRecord(resolution.observed) && Object.keys(resolution.observed).length
    ? essence(stableStringify(resolution.observed), 200)
    : null;
  const reason = resolution && typeof resolution.verdict_reason === 'string' && resolution.verdict_reason.trim()
    ? essence(resolution.verdict_reason, 160)
    : null;

  const outcome = outcomeOf({ kind: 'hypothesis', row });
  const verdictLabel =
    row.status === 'killed' && resolvedBy ? `killed (${resolvedBy})` : row.status;

  const episodeText = [
    `Situation: pre-registered hypothesis (domain: ${row.domain}) — claim: "${essence(row.claim, 200)}". Prediction: ${prediction}.`,
    `Action: ran the test to its floor/horizon${resolvedBy ? ` (resolved by ${resolvedBy})` : ''}.`,
    `Outcome: ${verdictLabel}${observed ? ` — observed ${observed}` : ''}${reason ? `; ${reason}` : ''}.`,
    `Lesson: ${verdictLabel}: ${essence(row.claim, 200)}`,
  ].join('\n');

  return {
    source_kind:  'hypothesis',
    source_id:    row.id,
    episode_text: episodeText,
    outcome,
    insight_ids:  Array.isArray(row.insight_ids) ? row.insight_ids : [],
    metadata: {
      domain: row.domain,
      status: row.status,
      ...(resolvedBy ? { resolved_by: resolvedBy } : {}),
    },
  };
}

// ── Outcome mapping ───────────────────────────────────────────────────────────

/**
 * Map a source to the episode outcome. Explicit rules per kind:
 *
 * hypothesis — the outcome of the BET, not of the learning:
 *   supported    → 'win'          (the claim held)
 *   refuted      → 'loss'         (the claim failed)
 *   killed       → 'loss'         (the arm was killed before floors — a loss)
 *   inconclusive → 'inconclusive' (floors unmet; proves nothing)
 *   anything else → 'unknown'     (unresolved rows should not become episodes)
 *
 * diagnosis — a diagnosis records a failure investigation:
 *   failed_link = 'none' → 'inconclusive' (nothing broke; weak evidence either way)
 *   any concrete link    → 'loss'         (a link demonstrably failed)
 */
export function outcomeOf(source: EpisodeSource): EpisodeOutcome {
  if (source.kind === 'hypothesis') {
    switch (source.row.status) {
      case 'supported':    return 'win';
      case 'refuted':      return 'loss';
      case 'killed':       return 'loss';
      case 'inconclusive': return 'inconclusive';
      default:             return 'unknown';
    }
  }
  return source.row.failed_link === 'none' ? 'inconclusive' : 'loss';
}

// ── Fleet-safe abstraction ────────────────────────────────────────────────────
// The regex PRIMITIVES (URL/email/IL-anchored phone stripping, gershayim-
// tolerant term matching) live in lib/pii, shared with lib/voc's storage-time
// stripping. This module owns the ABSTRACTION policy: {business}/{term}
// placeholders + the residual-length fleet-safety gate.

/** What remains after removing placeholders — the "is this still useful" measure. */
function residualLength(text: string): number {
  return text.replace(/\{[a-z]+\}/g, '').replace(/\s+/g, ' ').trim().length;
}

/**
 * PURE fleet-safe abstraction (reused by fleet recall and, later, C-12
 * playbooks). Strips the client name (all occurrences, case/whitespace/quote
 * tolerant — Hebrew-aware), phone numbers, emails, URLs, and any supplied
 * business terms, replacing each with a neutral placeholder ({business},
 * {phone}, {email}, {url}, {term}).
 *
 * Conservative by design: returns null when the redacted residue is too short
 * (< 40 meaningful chars) to be useful — callers then leave abstracted_text
 * null, which EXCLUDES the row from fleet recall (035 RPC filters on it).
 * Idempotent: placeholders never re-match, so abstracting twice is a no-op.
 */
export function abstractEpisode(
  episodeText: string,
  options: AbstractionOptions = {},
): string | null {
  if (typeof episodeText !== 'string' || !episodeText.trim()) return null;

  // Order matters (lib/pii doctrine): URLs → emails → phones → terms.
  let out = stripPhones(stripEmails(stripUrls(episodeText, '{url}'), '{email}'), '{phone}');

  const clientName = options.clientName?.trim();
  if (clientName) out = stripTerm(out, clientName, '{business}');

  for (const term of options.businessTerms ?? []) {
    out = stripTerm(out, term, '{term}');
  }

  out = out.trim();
  return residualLength(out) < 40 ? null : out;
}
