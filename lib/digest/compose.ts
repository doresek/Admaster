// lib/digest/compose.ts
//
// PURE digest composition — the heart of the weekly/monthly digest
// (VISION-DEEP §1.3). DETERMINISTIC and TOTAL, and deliberately NOT an LLM:
//
//   "Nothing here is generated 'creatively' — every clause is a read from
//    campaign_decisions.rationale, diagnoses.rationale, and atom states.
//    The report is the audit trail, narrated."  — §1.3
//
// The composer cannot hallucinate because it only SELECTS, ORDERS and
// TEMPLATES recorded rows:
//   • every section item carries the id of the row it was read from, and the
//     returned `sources` is exactly the set of contributing ids;
//   • rationales, claims and atom contents are copied VERBATIM;
//   • numbers (budgets, metrics, confidences) are echoed from row fields —
//     never computed into new ₪-amounts or percentages;
//   • a missing grounding atom is cited WITHOUT a confidence (never invented)
//     and recorded as a warning;
//   • a campaign without performance rows is reported as "data not in yet" —
//     dry-run honesty, no fabricated results.
//
// Determinism: same inputs → byte-identical rendered_text (stable sorts by
// date-then-id everywhere; no Date.now / locale APIs). Totality: malformed or
// partial rows are skipped with warnings — composeDigest never throws.

import type { DigestSources } from '@/lib/capability-contracts';
import type { Campaign, CampaignDecision } from '@/lib/campaigns/types';
import type {
  ApprovalRequest,
  AwaitingItem,
  ComposeResult,
  DigestContent,
  DigestFailedLink,
  DigestInputs,
  DigestSections,
  GroundingCitation,
  LearnedDiagnosis,
  LearnedHypothesis,
  NextHypothesis,
  NextPrecedent,
  ResolvedHypothesisStatus,
  ResultEntry,
  ResultItem,
  WhatRanDecision,
  WhatRanItem,
} from './types';

// ── deterministic helpers ─────────────────────────────────────────────────────

/** Byte-deterministic string compare (no localeCompare — locale-independent). */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Stable sort by a date-ish string, then id — same inputs, same order. */
function stableSort<T>(
  rows:   readonly T[],
  dateOf: (r: T) => string,
  idOf:   (r: T) => string,
): T[] {
  return [...rows].sort((a, b) => cmp(dateOf(a), dateOf(b)) || cmp(idOf(a), idOf(b)));
}

const sortedUnique = (ids: Iterable<string>): string[] => [...new Set(ids)].sort(cmp);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Echo a number from a row field verbatim (2-dp confidence rounding only). */
const num = (n: number): string => String(n);
const conf2 = (c: number): number => Math.round(c * 100) / 100;

const RESOLVED_STATUSES: readonly ResolvedHypothesisStatus[] =
  ['supported', 'refuted', 'inconclusive', 'killed'];

const isResolvedStatus = (s: string): s is ResolvedHypothesisStatus =>
  RESOLVED_STATUSES.some((r) => r === s);

// ── composition ───────────────────────────────────────────────────────────────

/**
 * Build the digest content + Hebrew narrative from recorded rows.
 *
 * `priorWarnings` lets the loader's row-narrowing warnings travel into the
 * persisted stats alongside composition warnings.
 */
export function composeDigest(
  inputs:        DigestInputs,
  priorWarnings: readonly string[] = [],
): ComposeResult {
  const warnings: string[] = [...priorWarnings];

  // Stable orderings — the sole ordering authority for every section.
  const campaigns  = stableSort(inputs.campaigns,  (c) => c.created_at ?? '', (c) => c.id);
  const decisions  = stableSort(inputs.decisions,  (d) => d.created_at ?? '', (d) => d.id);
  const diagnoses  = stableSort(inputs.diagnoses,  (d) => d.created_at,       (d) => d.id);
  const performance = stableSort(inputs.performance, (p) => p.created_at,     (p) => p.id);
  const resolvedHyps = stableSort(inputs.hypotheses.resolved, (h) => h.resolved_at ?? '', (h) => h.id);
  const openHyps     = stableSort(inputs.hypotheses.open,     (h) => h.registered_at,     (h) => h.id);

  const insightById    = new Map(inputs.insights.map((i) => [i.id, i]));
  const campaignById   = new Map(campaigns.map((c) => [c.id, c]));
  const itemToCampaign = new Map(inputs.items.map((i) => [i.id, i.campaign_id]));

  // Source accumulators — ONLY rows that actually contributed a clause.
  const srcCampaigns  = new Set<string>();
  const srcDecisions  = new Set<string>();
  const srcDiagnoses  = new Set<string>();
  const srcHypotheses = new Set<string>();

  /** Citation per grounded_in id: atom found → content + confidence; missing → no confidence, warning. */
  const cite = (ids: readonly string[], forWhat: string): GroundingCitation[] =>
    sortedUnique(ids).map((insightId) => {
      const atom = insightById.get(insightId);
      if (!atom) {
        warnings.push(`grounding atom ${insightId} not found (active) for ${forWhat} — cited without confidence`);
        return { insight_id: insightId, content: null, confidence: null };
      }
      return { insight_id: insightId, content: atom.content, confidence: conf2(atom.confidence) };
    });

  // ── 📣 what_ran — campaigns active in the period, angle + grounding cited ──
  const whatRan: WhatRanItem[] = [];
  for (const c of campaigns) {
    const decsFor = decisions.filter((d) => d.campaign_id === c.id);

    let angle: string | null = null;
    let angleDecisionId: string | null = null;
    let angleGrounding: readonly string[] | null = null;
    const otherDecisions: WhatRanDecision[] = [];

    for (const d of decsFor) {
      if (d.decision_type === 'precedents') continue; // narrated (and sourced) under ⏭️
      if (!nonEmptyString(d.rationale)) {
        warnings.push(`decision ${d.id}: empty rationale — skipped`);
        continue;
      }
      if (d.decision_type === 'angle' && angle === null) {
        const value = isRecord(d.decision) ? d.decision['angle'] ?? d.decision['value'] : undefined;
        if (nonEmptyString(value)) {
          angle = value;
          angleDecisionId = d.id;
          angleGrounding = d.grounded_in;
          srcDecisions.add(d.id);
          continue;
        }
        warnings.push(`decision ${d.id}: angle decision has no angle value — narrated by rationale only`);
      }
      otherDecisions.push({ decision_id: d.id, decision_type: d.decision_type, rationale: d.rationale });
      srcDecisions.add(d.id);
    }

    // Grounding: prefer the angle decision's grounded_in; else the campaign's.
    const grounding = cite(angleGrounding ?? c.grounded_in, `campaign ${c.id}`);

    whatRan.push({
      campaign_id:       c.id,
      name:              c.name,
      channel:           c.channel,
      status:            c.status,
      funnel_stage:      c.funnel_stage,
      daily_budget:      c.daily_budget,
      dry_run:           c.dry_run,
      rationale:         nonEmptyString(c.rationale) ? c.rationale : null,
      angle,
      angle_decision_id: angleDecisionId,
      grounding,
      other_decisions:   otherDecisions,
    });
    srcCampaigns.add(c.id);
  }

  // Precedent notes (episodic memory, decision_type 'precedents') → ⏭️ section.
  const precedentNotes: NextPrecedent[] = [];
  for (const d of decisions) {
    if (d.decision_type !== 'precedents') continue;
    if (!nonEmptyString(d.rationale)) {
      warnings.push(`decision ${d.id}: precedents row has empty rationale — skipped`);
      continue;
    }
    precedentNotes.push({ decision_id: d.id, rationale: d.rationale });
    srcDecisions.add(d.id);
  }

  // Decisions that attach to no campaign in this period (client-level rows or
  // out-of-period campaigns) have no section to live in — recorded as a
  // warning so nothing silently disappears from the audit trail.
  for (const d of decisions) {
    if (d.decision_type === 'precedents') continue;
    if (d.campaign_id === null || !campaignById.has(d.campaign_id)) {
      warnings.push(`decision ${d.id} (${d.decision_type}) has no campaign in this period — not narrated`);
    }
  }

  // ── 📊 results — content_performance verdicts; NO fabrication ─────────────
  // Only metric keys that literally exist on the row are echoed.
  const entriesByCampaign = new Map<string, ResultEntry[]>();
  for (const p of performance) {
    const campaignId = p.campaign_item_id !== null ? itemToCampaign.get(p.campaign_item_id) : undefined;
    if (campaignId === undefined || !campaignById.has(campaignId)) {
      warnings.push(`performance ${p.id}: not linked to a campaign in this period — skipped`);
      continue;
    }
    const metrics: Record<string, number> = {};
    for (const { key } of METRIC_KEYS) {
      const v = isRecord(p.metrics) ? p.metrics[key] : undefined;
      if (isFiniteNumber(v)) metrics[key] = v;
    }
    const list = entriesByCampaign.get(campaignId) ?? [];
    list.push({ performance_id: p.id, verdict: p.verdict, metrics });
    entriesByCampaign.set(campaignId, list);
  }

  const measured: ResultItem[] = [];
  const awaiting: AwaitingItem[] = [];
  for (const item of whatRan) {
    const entries = entriesByCampaign.get(item.campaign_id);
    if (entries && entries.length > 0) {
      measured.push({ campaign_id: item.campaign_id, campaign_name: item.name, entries });
    } else {
      awaiting.push({ campaign_id: item.campaign_id, campaign_name: item.name });
    }
  }

  // ── 🧠 learned — diagnoses (rationale VERBATIM) + resolved hypotheses ─────
  const learnedDiagnoses: LearnedDiagnosis[] = [];
  for (const d of diagnoses) {
    if (!nonEmptyString(d.rationale)) {
      warnings.push(`diagnosis ${d.id}: empty rationale — skipped`);
      continue;
    }
    const campaign = d.scope_campaign_id !== null ? campaignById.get(d.scope_campaign_id) : undefined;
    learnedDiagnoses.push({
      diagnosis_id:  d.id,
      campaign_id:   d.scope_campaign_id,
      campaign_name: campaign ? campaign.name : null,
      failed_link:   d.failed_link,
      rationale:     d.rationale,
    });
    srcDiagnoses.add(d.id);
    if (campaign) srcCampaigns.add(campaign.id);
  }

  const learnedHypotheses: LearnedHypothesis[] = [];
  for (const h of resolvedHyps) {
    if (!isResolvedStatus(h.status)) {
      warnings.push(`hypothesis ${h.id}: status '${h.status}' is not a resolution — skipped`);
      continue;
    }
    if (!nonEmptyString(h.claim)) {
      warnings.push(`hypothesis ${h.id}: empty claim — skipped`);
      continue;
    }
    const reason = h.resolution !== null && nonEmptyString(h.resolution.verdict_reason)
      ? h.resolution.verdict_reason
      : null;
    learnedHypotheses.push({
      hypothesis_id:  h.id,
      claim:          h.claim,
      status:         h.status,
      verdict_reason: reason,
    });
    srcHypotheses.add(h.id);
  }

  // ── ⏭️ next — open hypotheses (with their recorded horizons) ──────────────
  const nextHypotheses: NextHypothesis[] = [];
  for (const h of openHyps) {
    if (h.status !== 'open') {
      warnings.push(`hypothesis ${h.id}: expected open, got '${h.status}' — skipped`);
      continue;
    }
    if (!nonEmptyString(h.claim)) {
      warnings.push(`hypothesis ${h.id}: empty claim — skipped`);
      continue;
    }
    const horizon = isRecord(h.horizon) ? h.horizon : {};
    nextHypotheses.push({
      hypothesis_id: h.id,
      claim:         h.claim,
      max_days:      isFiniteNumber(horizon['max_days'])  ? horizon['max_days']  : null,
      max_spend:     isFiniteNumber(horizon['max_spend']) ? horizon['max_spend'] : null,
    });
    srcHypotheses.add(h.id);
  }

  // ── ✅ approvals — passed through from the autonomy layer, narrated only ──
  const approvals: ApprovalRequest[] = [];
  for (const a of inputs.approvalsNeeded) {
    if (!nonEmptyString(a.kind) || !nonEmptyString(a.rationale) || !nonEmptyString(a.ref)) {
      warnings.push(`approval request skipped — missing kind/rationale/ref`);
      continue;
    }
    approvals.push({ kind: a.kind, rationale: a.rationale, ref: a.ref });
  }
  approvals.sort((a, b) => cmp(a.ref, b.ref) || cmp(a.kind, b.kind) || cmp(a.rationale, b.rationale));

  const sections: DigestSections = {
    what_ran: whatRan,
    results:  { measured, awaiting },
    learned:  { diagnoses: learnedDiagnoses, resolved_hypotheses: learnedHypotheses },
    next:     { open_hypotheses: nextHypotheses, precedent_notes: precedentNotes },
    approvals_needed: approvals,
  };

  const content: DigestContent = {
    period:   inputs.period,
    sections,
    stats: {
      campaigns:           whatRan.length,
      decisions:           srcDecisions.size,
      diagnoses:           learnedDiagnoses.length,
      hypotheses_resolved: learnedHypotheses.length,
      hypotheses_open:     nextHypotheses.length,
      performance_rows:    measured.reduce((n, m) => n + m.entries.length, 0),
      warnings,
    },
  };

  const sources: DigestSources = {
    campaign_ids:   sortedUnique(srcCampaigns),
    decision_ids:   sortedUnique(srcDecisions),
    diagnosis_ids:  sortedUnique(srcDiagnoses),
    hypothesis_ids: sortedUnique(srcHypotheses),
  };

  return { content, rendered_text: renderHebrew(content), sources, warnings };
}

// ── Hebrew rendering (template-based; business-warm, dugri-leaning) ───────────
// Every clause below is a template around ROW FIELDS — no free generation.
// Grammar craft: singular/plural agreement for counts, IL date format.

/** Metric keys the renderer may echo (values verbatim from metrics jsonb). */
const METRIC_KEYS: readonly { key: string; label: string; money: boolean }[] = [
  { key: 'impressions', label: 'חשיפות',     money: false },
  { key: 'reach',       label: 'הגעה',       money: false },
  { key: 'clicks',      label: 'קליקים',     money: false },
  { key: 'ctr',         label: 'CTR',        money: false },
  { key: 'conversions', label: 'המרות',      money: false },
  { key: 'leads',       label: 'לידים',      money: false },
  { key: 'spend',       label: 'הוצאה',      money: true  },
  { key: 'cpa',         label: 'עלות להמרה', money: true  },
  { key: 'roas',        label: 'ROAS',       money: false },
];

const CHANNEL_HE: Record<string, string> = {
  meta_paid:    'מטא ממומן',
  meta_organic: 'מטא אורגני',
  whatsapp:     'וואטסאפ',
};

const VERDICT_HE: Record<string, string> = {
  worked:         'עבד',
  underperformed: 'מתחת לציפיות',
  failed:         'נכשל',
};

const FAILED_LINK_HE: Record<DigestFailedLink, string> = {
  hook:     'ההוק (הפתיח)',
  avatar:   'התאמת האווטאר',
  creative: 'הקריאייטיב',
  funnel:   'המשפך — דף הנחיתה וההצעה',
  offer:    'ההצעה',
  audience: 'הקהל',
  none:     'לא זוהה כשל',
};

const RESOLUTION_HE: Record<ResolvedHypothesisStatus, string> = {
  supported:    'אושרה',
  refuted:      'הופרכה',
  inconclusive: 'לא הוכרעה',
  killed:       'נעצרה מוקדם',
};

const DECISION_TYPE_HE: Record<string, string> = {
  angle:     'זווית',
  audience:  'קהל',
  platform:  'פלטפורמה',
  budget:    'תקציב',
  objective: 'מטרה',
  funnel:    'משפך',
  channel:   'ערוץ',
};

/** '2026-06-22' → '22.06.2026' (IL format, no locale APIs — deterministic). */
function ilDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d !== undefined && m !== undefined && y !== undefined ? `${d}.${m}.${y}` : iso;
}

/** Correct singular/plural agreement: 'רץ קמפיין אחד' / 'רצו 2 קמפיינים'. */
function campaignsRanClause(n: number): string {
  return n === 1 ? 'רץ קמפיין אחד' : `רצו ${n} קמפיינים`;
}

function renderCitation(g: GroundingCitation): string {
  if (g.content !== null && g.confidence !== null) {
    return `מבוססת על התובנה "${g.content}" בביטחון ${num(g.confidence)}`;
  }
  // Missing atom: cite that a recorded grounding exists — NEVER invent a confidence.
  return 'מבוססת על תובנה מתועדת שאינה זמינה עוד';
}

function renderMetrics(metrics: Record<string, number>): string {
  const parts: string[] = [];
  for (const { key, label, money } of METRIC_KEYS) {
    const v = metrics[key];
    if (v === undefined) continue;
    parts.push(money ? `${label} ₪${num(v)}` : `${label} ${num(v)}`);
  }
  return parts.join(' · ');
}

/**
 * Render the Hebrew narrative from DigestContent. Pure + deterministic —
 * a template walk over the sections; every sentence is built from row fields.
 */
export function renderHebrew(content: DigestContent): string {
  const { period, sections } = content;
  const weekly = period.kind === 'weekly';
  const L: string[] = [];

  L.push(`${weekly ? 'סיכום שבועי' : 'סיכום חודשי'} · ${ilDate(period.start)}–${ilDate(period.end)}`);
  L.push('');

  const quiet = sections.what_ran.length === 0;
  if (quiet) {
    // Honest quiet digest — not an error (§1.3 dry-run honesty).
    L.push(weekly
      ? 'שבוע שקט — אין קמפיינים פעילים. לא נרשמו החלטות חדשות בתקופה הזו.'
      : 'חודש שקט — אין קמפיינים פעילים. לא נרשמו החלטות חדשות בתקופה הזו.');
    L.push('');
  } else {
    // ── 📣 מה רץ ──
    L.push('📣 מה רץ');
    L.push(`${weekly ? 'השבוע' : 'החודש'} ${campaignsRanClause(sections.what_ran.length)}:`);
    for (const c of sections.what_ran) {
      const channel = CHANNEL_HE[c.channel] ?? c.channel;
      const bits = [channel];
      if (c.funnel_stage !== null) bits.push(c.funnel_stage);
      if (c.daily_budget !== null) bits.push(`תקציב יומי ₪${num(c.daily_budget)}`);
      const dry = c.dry_run ? ' (הרצה יבשה — לא הוצא תקציב אמיתי)' : '';
      L.push(`• ${c.name} — ${bits.join(', ')}${dry}`);
      if (c.angle !== null) {
        const citations = c.grounding.map(renderCitation).join('; ');
        L.push(`  זווית '${c.angle}'${citations ? ` (${citations})` : ''}`);
      } else if (c.grounding.length > 0) {
        L.push(`  ${c.grounding.map(renderCitation).join('; ')}`);
      }
      if (c.rationale !== null) L.push(`  למה: ${c.rationale}`);
      for (const d of c.other_decisions) {
        L.push(`  ◦ ${DECISION_TYPE_HE[d.decision_type] ?? d.decision_type}: ${d.rationale}`);
      }
    }
    L.push('');

    // ── 📊 תוצאות ──
    L.push('📊 תוצאות');
    for (const m of sections.results.measured) {
      for (const e of m.entries) {
        const verdict = e.verdict !== null ? VERDICT_HE[e.verdict] ?? e.verdict : 'נמדד, טרם נקבעה הכרעה';
        const metrics = renderMetrics(e.metrics);
        L.push(`• ${m.campaign_name}: ${verdict}${metrics ? ` — ${metrics}` : ''}`);
      }
    }
    for (const a of sections.results.awaiting) {
      // Dry-run honesty: no data → say so; never invent numbers.
      L.push(`• ${a.campaign_name}: הנתונים עוד לא נכנסו מהפלטפורמה — בלי מדידה אין מסקנות. נעדכן בדוח הבא.`);
    }
    L.push('');
  }

  // ── 🧠 מה למדנו ──
  const learned = sections.learned;
  if (learned.diagnoses.length > 0 || learned.resolved_hypotheses.length > 0) {
    L.push('🧠 מה למדנו');
    for (const d of learned.diagnoses) {
      const scope = d.campaign_name !== null ? ` (${d.campaign_name})` : '';
      const head = d.failed_link === 'none'
        ? `לא זוהה כשל`
        : `הכשל זוהה בחוליית ${FAILED_LINK_HE[d.failed_link]}`;
      L.push(`• אבחון${scope}: ${head} — ${d.rationale}`);
    }
    for (const h of learned.resolved_hypotheses) {
      const reason = h.verdict_reason !== null ? ` — ${h.verdict_reason}` : '';
      L.push(`• ההשערה "${h.claim}" ${RESOLUTION_HE[h.status]}${reason}`);
    }
    L.push('');
  }

  // ── ⏭️ השבוע/החודש הבא ──
  const next = sections.next;
  if (next.open_hypotheses.length > 0 || next.precedent_notes.length > 0) {
    L.push(`⏭️ ${weekly ? 'השבוע הבא' : 'החודש הבא'}`);
    for (const h of next.open_hypotheses) {
      const bounds: string[] = [];
      if (h.max_days !== null)  bounds.push(`עד ${num(h.max_days)} ימים`);
      if (h.max_spend !== null) bounds.push(`עד ₪${num(h.max_spend)}`);
      L.push(`• ממשיכים לבדוק: "${h.claim}"${bounds.length > 0 ? ` (${bounds.join(' או ')})` : ''}`);
    }
    for (const p of next.precedent_notes) {
      L.push(`• מהזיכרון (תקדימים): ${p.rationale}`);
    }
    L.push('');
  }

  // ── ✅ ממתין לאישורך — always present; the approve-tap is the loop (§1.4) ──
  L.push('✅ ממתין לאישורך');
  if (sections.approvals_needed.length > 0) {
    for (const a of sections.approvals_needed) {
      L.push(`• ${a.rationale} (${a.kind})`);
    }
  } else {
    L.push('אין פעולות שממתינות לאישורך.');
  }
  L.push('');

  L.push('—');
  L.push('כל שורה בדוח נובעת מרשומה ביומן ההחלטות של המערכת — אפשר לעקוב אחרי כל קביעה עד המקור.');

  return L.join('\n');
}
