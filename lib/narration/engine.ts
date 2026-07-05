// lib/narration/engine.ts
//
// THE GENERAL DETERMINISTIC NARRATION ENGINE (D-0, DASHBOARD-ARCHITECTURE
// §0.2). Metrics layer first, LLM second: this engine SELECTS, ORDERS and
// TEMPLATES typed facts — metric values, diagnosis rationales, atom citations,
// pending actions. It cannot hallucinate because:
//   • every interpolated number is String(field) of an input value — there is
//     NO arithmetic here that could mint a ₪-amount or a percentage;
//   • rationales and atom contents are copied VERBATIM;
//   • a missing atom confidence is cited as missing (never invented) and
//     recorded as a warning;
//   • every clause's fact id accumulates into `sources` (namespaced:
//     metric:/diagnosis:/atom:/action:) — the §1.3 audit-trail discipline,
//     generalized from the digest composer.
//
// Determinism: same inputs → byte-identical text (fixed narration order, no
// clock, no locale APIs). Register (§1): 'owner' = business-warm, zero jargon
// (no CTR/ROAS/CPM tokens); 'marketer' = fuller vocabulary. Same facts.

import type { MetricKey, MetricValue } from '@/lib/metrics-layer';
import {
  benchmarkClause,
  cmp,
  deltaClause,
  fmtValue,
  goalClause,
  ilDate,
  leadsPhrase,
  sortedUnique,
} from './format';
import type { NarrationInput, NarrationRegister, NarrationResult } from './types';

// ── selection & ordering (the story hierarchy, not the registry's order) ─────

/** Fixed narration order — the ONE ordering authority (shuffle-invariance). */
const NARRATION_ORDER: readonly MetricKey[] = [
  'leads_total',
  'cost_per_lead',
  'roas_vs_breakeven',
  'closed_value',
  'close_rate',
  'leads_qualified',
  'qualified_rate',
  'irrelevant_rate',
  'contacted_24h_rate',
  'consent_rate',
  'spend_total',
  'reconciliation_ratio',
];

/**
 * Metrics the OWNER register never shows: internal-honesty/ops metrics that
 * mean nothing without marketer vocabulary. The honesty they carry still
 * reaches the owner through honesty labels on the visible metrics.
 */
const OWNER_HIDDEN: readonly MetricKey[] = ['reconciliation_ratio'];

function narrationSorted(metrics: readonly MetricValue[]): MetricValue[] {
  const index = new Map<string, number>(NARRATION_ORDER.map((k, i) => [k, i]));
  return [...metrics].sort((a, b) => {
    const ai = index.get(a.key) ?? NARRATION_ORDER.length;
    const bi = index.get(b.key) ?? NARRATION_ORDER.length;
    return ai - bi || cmp(a.key, b.key);
  });
}

const byKey = (metrics: readonly MetricValue[], key: MetricKey): MetricValue | null =>
  metrics.find((m) => m.key === key) ?? null;

// ── clause templates ──────────────────────────────────────────────────────────

/** roas_vs_breakeven, owner voice: worth-it framing, no 'ROAS' token. */
function worthItClause(m: MetricValue): string | null {
  if (m.value === null) return null;
  return m.value >= 1
    ? `הפרסום משתלם — פי ${String(m.value)} מנקודת האיזון ✅`
    : `הפרסום עדיין לא משתלם — פי ${String(m.value)} מנקודת האיזון ⚠️`;
}

/** One detail line for a computable metric. */
function metricLine(m: MetricValue, register: NarrationRegister): string {
  const name = register === 'marketer' && m.key === 'roas_vs_breakeven'
    ? 'ROAS מול נקודת איזון'
    : m.name_he;
  const parts: string[] = [];
  if (m.value !== null) parts.push(fmtValue(m.value, m.unit));
  const delta = deltaClause(m);
  if (delta !== null) parts.push(delta);
  const goal = goalClause(m);
  if (goal !== null) parts.push(goal);
  const bench = benchmarkClause(m);
  if (bench !== null) parts.push(bench);
  const honesty = m.honesty_label !== null ? ` [${m.honesty_label}]` : '';
  return `• ${name}: ${parts.join(' · ')}${honesty}`;
}

// ── the engine ────────────────────────────────────────────────────────────────

/**
 * Narrate one client's period from typed facts. One-line story first, then
 * detail lines, then the why (diagnoses), grounding (atoms) and pending
 * actions — progressive disclosure (§0.3 leap 1).
 */
export function narrate(input: NarrationInput, register: NarrationRegister): NarrationResult {
  const warnings: string[] = [];
  const sources = new Set<string>();
  const L: string[] = [];

  const metrics = narrationSorted(input.metrics);

  // ── the one-line story ──
  L.push(`תקופה: ${ilDate(input.period.start)}–${ilDate(input.period.end)}`);
  const headBits: string[] = [];
  const leadsM = byKey(metrics, 'leads_total');
  if (leadsM !== null && leadsM.value !== null) {
    headBits.push(leadsPhrase(leadsM.value));
    sources.add(`metric:${leadsM.key}`);
  }
  const cplM = byKey(metrics, 'cost_per_lead');
  if (cplM !== null && cplM.value !== null) {
    headBits.push(`₪${String(cplM.value)} לליד`);
    sources.add(`metric:${cplM.key}`);
  }
  const roasM = byKey(metrics, 'roas_vs_breakeven');
  if (roasM !== null && roasM.value !== null) {
    headBits.push(roasM.value >= 1 ? 'משתלם ✅' : 'עדיין לא משתלם ⚠️');
    sources.add(`metric:${roasM.key}`);
  }
  L.push(headBits.length > 0
    ? headBits.join(' · ')
    : 'עוד אין מספיק נתונים לתקופה הזו — נעדכן ברגע שייכנסו.');
  L.push('');

  // ── detail lines ──
  for (const m of metrics) {
    if (register === 'owner' && OWNER_HIDDEN.some((k) => k === m.key)) continue;

    if (m.value === null) {
      // Honesty without noise: the marketer sees the reason inline; the owner
      // screen stays clean (the reason travels as a warning, not a clause).
      if (register === 'marketer') {
        const reason = m.not_computable_reason ?? 'לא ניתן לחישוב';
        L.push(`• ${m.name_he}: לא ניתן לחישוב — ${reason}`);
        sources.add(`metric:${m.key}`);
      } else {
        warnings.push(`metric ${m.key} not shown to owner: ${m.not_computable_reason ?? 'not computable'}`);
      }
      continue;
    }

    if (register === 'owner' && m.key === 'roas_vs_breakeven') {
      const clause = worthItClause(m);
      if (clause !== null) {
        L.push(`• ${clause}`);
        sources.add(`metric:${m.key}`);
      }
      continue;
    }

    L.push(metricLine(m, register));
    sources.add(`metric:${m.key}`);
  }

  // ── the why (diagnosis rationales VERBATIM) ──
  const diagnoses = [...input.diagnoses].sort((a, b) => cmp(a.id, b.id));
  if (diagnoses.length > 0) {
    L.push('');
    for (const d of diagnoses) {
      const scope = d.campaign_name !== undefined && d.campaign_name !== null
        ? ` (${d.campaign_name})` : '';
      L.push(`למה${scope}: ${d.rationale}`);
      sources.add(`diagnosis:${d.id}`);
    }
  }

  // ── grounding (atom citations; missing confidence cited as missing) ──
  const atoms = [...input.atoms].sort((a, b) => cmp(a.id, b.id));
  if (atoms.length > 0) {
    L.push('');
    for (const a of atoms) {
      if (a.confidence !== null) {
        L.push(`מבוסס על התובנה "${a.content}" (ביטחון ${String(a.confidence)})`);
      } else {
        L.push(`מבוסס על התובנה "${a.content}" (ללא ביטחון רשום)`);
        warnings.push(`atom ${a.id} cited without a recorded confidence`);
      }
      sources.add(`atom:${a.id}`);
    }
  }

  // ── pending actions (leap 6 — act from here) ──
  const actions = [...input.pendingActions].sort((a, b) => cmp(a.id, b.id));
  if (actions.length > 0) {
    L.push('');
    for (const a of actions) {
      // The owner reads the plain-Hebrew rationale; the marketer also sees the
      // machine verb (kind) for traceability.
      L.push(register === 'marketer'
        ? `⚡ ממתין לאישורך: ${a.rationale} (${a.kind})`
        : `⚡ ממתין לאישורך: ${a.rationale}`);
      sources.add(`action:${a.id}`);
    }
  }

  return { text_he: L.join('\n'), sources: sortedUnique(sources), warnings };
}
