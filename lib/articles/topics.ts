// lib/articles/topics.ts
//
// P3-2 TOPIC ENGINE — deterministic scoring core (no LLM).
// BINDING SPEC: docs/ORGANIC-DEEP-RESEARCH.md §1.1 (Atom→query mapping).
//
// Three §1.1 mechanics, implemented literally:
//   1. Atom→query mapping — each customers-layer atom kind emits its specified
//      query-intent family (pain → symptom queries; objection → "כמה עולה X
//      ב[עיר]" / "X מחיר" / "האם כדאי X"; desire → outcome queries;
//      unspoken_want → private-question GEO material; alternative → "X או Y" /
//      "ההבדל בין"; proof → "לפני אחרי"/"המלצות"/"ביקורות"). Business atoms
//      generate NO topics — they are attached to every topic as the
//      information-gain injections (§1.1 last row).
//   2. Hebrew morphological expansion — ב/ל/מ/ה prefixes + gender/number/
//      construct forms applied at generation time: one atom → dozens of query
//      forms.
//   3. Commercial-intent-first priority — commercial/transactional/local-action
//      topics outrank informational ones ALWAYS (informational queries are
//      92–94% swallowed by AI answers; their KPI is citation, not clicks).
//      Encoded as intent weights whose bands cannot cross: the lowest possible
//      commercial-group score (weight·0.5 at confidence 0) is still above the
//      highest possible informational score (weight·1.0 + VoC boost).
//      Within a band, atom confidence orders topics.

import type { ClientInsight } from '@/lib/intelligence/types';
import type {
  ArticleTopic,
  BuildTopicBacklogInput,
  TopicContentType,
  TopicIntent,
  VocQuestionInput,
} from './types';

// ── §1.1 mapping table (atom kind → intent / content type / weight) ──────────

interface KindMapping {
  intent:       TopicIntent;
  contentType:  TopicContentType;
  /** Intent weight for the priority rule. Commercial group ∈ [0.9..1.0];
      informational group ≤ 0.38 so bands never cross (see header). */
  weight:       number;
}

export const ATOM_QUERY_MAP: Record<string, KindMapping> = {
  // objection ("פחד שיכאב", "יקר") → "האם כדאי X", "כמה עולה X ב[עיר]", "X מחיר"
  // — MOFU pricing/comparison; commercial intent still gets clicks.
  objection:     { intent: 'commercial',    contentType: 'mofu_pricing_comparison', weight: 1.0 },
  // desire/aspiration/dream → outcome queries ("חיוך בטוח", "X לפני חתונה")
  desire:        { intent: 'transactional', contentType: 'service_page_angle',      weight: 0.95 },
  aspiration:    { intent: 'transactional', contentType: 'service_page_angle',      weight: 0.95 },
  dream:         { intent: 'transactional', contentType: 'service_page_angle',      weight: 0.95 },
  // alternative (competitor atoms, C-09) → "X או Y", "ההבדל בין" — the open lane.
  alternative:   { intent: 'comparison',    contentType: 'comparison_page',         weight: 0.9 },
  // proof → "לפני אחרי", "המלצות", "ביקורות" — E-E-A-T assets.
  proof:         { intent: 'commercial',    contentType: 'eeat_asset',              weight: 0.9 },
  // unspoken_want → the questions people ask AI privately — prime GEO material.
  unspoken_want: { intent: 'informational', contentType: 'geo_faq_article',         weight: 0.38 },
  // pain ("כואב לי ללכת") → symptom/problem queries — TOFU article + FAQ.
  pain:          { intent: 'informational', contentType: 'tofu_article_faq',        weight: 0.35 },
};

/** Real-customer-language boost (VoC quote bank = the doc's "quotations" GEO
    lever). Small enough that it can never lift informational above the
    commercial band (0.38 + 0.05 = 0.43 < 0.9 · 0.5 = 0.45). */
export const VOC_BOOST = 0.05;

/** Confidence for topics born from a VoC question with no backing atom
    (mirrors CONFIDENCE.START for a fresh belief). */
const VOC_ONLY_CONFIDENCE = 0.5;

const DEFAULT_MAX_PATTERNS = 16;
const DEFAULT_MAX_TOPICS   = 50;

// ── Hebrew morphological expansion (§1.1: gender/number/construct, ב/ל/מ/ה) ──

export const HEBREW_PREFIXES = ['ה', 'ב', 'ל', 'מ'] as const;

const HEBREW_RE = /[֐-׿]/;

/**
 * Expand a Hebrew term into query variants: the §1.1 rule — ב/ל/מ/ה prefixes
 * plus gender/number/construct forms — applied to the HEAD word (the rest of a
 * multi-word term is carried unchanged). Deterministic heuristics:
 *   • prefixes on the base head (הטיפול / בטיפול / לטיפול / מטיפול)
 *   • ה-final head (feminine): plural ה→ות (עוגה→עוגות), construct ה→ת (עוגה→עוגת)
 *   • otherwise (masculine): plural +ים (טיפול→טיפולים)
 *   • ה-prefix on each inflection (הטיפולים)
 * Semantic inflection (root-aware binyanim) is out of scope for the
 * deterministic core — the P3-3 LLM pass refines phrasing.
 */
export function expandHebrewTerm(term: string): string[] {
  const t = term.trim().replace(/\s+/g, ' ');
  if (!t) return [];
  const [head, ...rest] = t.split(' ');
  const tail = rest.length ? ' ' + rest.join(' ') : '';

  const heads: string[] = [head];
  if (HEBREW_RE.test(head) && head.length >= 2) {
    for (const p of HEBREW_PREFIXES) heads.push(p + head);
    const inflections = head.endsWith('ה')
      ? [head.slice(0, -1) + 'ות', head.slice(0, -1) + 'ת']  // fem plural + construct
      : [head + 'ים'];                                        // masc plural
    for (const inf of inflections) {
      heads.push(inf);
      heads.push('ה' + inf);
    }
  }
  return dedupe(heads.map((h) => h + tail));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIRST_PERSON = new Set([
  'אני', 'לי', 'שלי', 'אותי', 'אצלי', 'עליי', 'עלי',
  'אנחנו', 'לנו', 'שלנו', 'אותנו', 'אצלנו',
]);

/**
 * Depersonalize customer language into a query-shaped phrase: strip quotes/
 * punctuation and first-person tokens ("כואב לי ללכת" → "כואב ללכת").
 * NOTE (§1.1 ambiguity): the doc's example maps "כואב לי ללכת" to the richer
 * "כאב בכף הרגל בהליכה" — that is semantic rewriting, which needs an LLM. The
 * deterministic core does first-person stripping; P3-3's generation pass owns
 * semantic query refinement.
 */
export function depersonalizeHe(content: string): string {
  return content
    .replace(/["'‘’“”?!.,]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FIRST_PERSON.has(w))
    .join(' ')
    .trim();
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const s = raw.trim().replace(/\s+/g, ' ');
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeForMatch(s: string): string {
  return s.replace(/["'‘’“”?!.,׳״-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

/** score = intentWeight · (0.5 + 0.5·confidence) + VoC boost — confidence
    orders topics WITHIN an intent band; bands never cross (priority rule). */
function scoreTopic(weight: number, confidence: number, vocBacked: boolean): number {
  const raw = weight * (0.5 + 0.5 * clamp01(confidence)) + (vocBacked ? VOC_BOOST : 0);
  return Math.round(raw * 10_000) / 10_000;
}

/** Shorten a business-atom sentence into a usable offer term (≤6 words). */
function toOfferTerm(content: string): string {
  return depersonalizeHe(content).split(' ').slice(0, 6).join(' ');
}

// ── Per-kind pattern + title builders ────────────────────────────────────────

interface BuildCtx {
  offer?: string;
  city?:  string;
  maxPatterns: number;
}

interface KindBuild {
  title:    string;
  /** templates[0] is the PRIMARY query — morphological expansion is applied
      inside it (one atom → dozens of forms); the rest are emitted once. */
  patterns: string[];
  subject:  string;
}

function buildForKind(kind: string, content: string, ctx: BuildCtx): KindBuild | null {
  const dep = depersonalizeHe(content);
  if (!dep) return null;
  const { offer, city } = ctx;

  switch (kind) {
    case 'pain':
      // symptom/problem queries — the depersonalized pain phrase IS the query.
      return {
        subject: dep,
        title: `${dep} — למה זה קורה ומה עושים?`,
        patterns: [dep],
      };
    case 'objection': {
      // "כמה עולה X ב[עיר]", "X מחיר", "האם כדאי X" — needs the offer as X.
      const x = offer ?? dep;
      return {
        subject: x,
        title: `כמה עולה ${x}? מחיר, כדאיות וכל התשובות`,
        patterns: [
          `כמה עולה ${x}`,
          ...(city ? [`כמה עולה ${x} ב${city}`] : []),
          `${x} מחיר`,
          `האם כדאי ${x}`,
          ...(offer && dep !== offer ? [`${x} ${dep}`] : []),
        ],
      };
    }
    case 'desire':
    case 'aspiration':
    case 'dream':
      // outcome queries ("חיוך בטוח", "X לפני חתונה").
      return {
        subject: dep,
        title: `${dep}: איך משיגים את זה באמת`,
        patterns: [dep, ...(offer ? [`${offer} ${dep}`] : []), ...(city ? [`${dep} ב${city}`] : [])],
      };
    case 'unspoken_want':
      // the questions people ask AI privately — answer-first FAQ/article.
      return {
        subject: dep,
        title: `${dep} — התשובה המלאה`,
        patterns: [dep, `האם ${dep}`, `איך ${dep}`],
      };
    case 'alternative': {
      // "X או Y", "ההבדל בין" — Y is the competitor/alternative from the atom.
      if (!offer) {
        return { subject: dep, title: `${dep} — האם יש דרך טובה יותר?`, patterns: [dep, `ההבדל בין ${dep}`] };
      }
      return {
        subject: offer,
        title: `${offer} או ${dep}: מה עדיף ומה ההבדל?`,
        patterns: [`${offer} או ${dep}`, `ההבדל בין ${offer} ל${dep}`, `${dep} או ${offer}`],
      };
    }
    case 'proof': {
      // "לפני אחרי", "המלצות", "ביקורות" — E-E-A-T assets.
      const x = offer ?? dep;
      return {
        subject: x,
        title: `${x}: לפני ואחרי, המלצות וביקורות אמיתיות`,
        patterns: [`${x} לפני אחרי`, `${x} המלצות`, `${x} ביקורות`, ...(city ? [`${x} מומלץ ב${city}`] : [])],
      };
    }
    default:
      return null; // awareness/persona and business kinds do not map to queries (§1.1)
  }
}

/** Instantiate patterns: emit the declared templates once, then apply
    morphological expansion inside the PRIMARY template (dozens of forms). */
function expandPatterns(build: KindBuild, maxPatterns: number): string[] {
  const primary = build.patterns[0];
  const variants = expandHebrewTerm(build.subject).map((v) => primary.replace(build.subject, v));
  return dedupe([...build.patterns, ...variants]).slice(0, maxPatterns);
}

// ── VoC question derivation (route helper, deterministic + testable) ─────────

// NOTE: \b is ASCII-only in JS — Hebrew letters are not \w — so the word
// boundary after the question word is expressed as whitespace/end explicitly.
const QUESTION_RE = /\?|^(האם|כמה|איך|מה|למה|מדוע|מתי|איפה|כדאי)(\s|$)/;

/** Filter VoC quote-bank rows down to question-shaped verbatim customer
    language ("the questions people ask AI privately" — §1.1 unspoken_want row). */
export function deriveVocQuestions(
  quotes: ReadonlyArray<{ id: string; quote: string }>,
): VocQuestionInput[] {
  return quotes
    .filter((q) => QUESTION_RE.test(q.quote.trim()))
    .map((q) => ({ text: q.quote.trim(), quoteId: q.id }));
}

function vocQuestionIntent(text: string): { intent: TopicIntent; weight: number } {
  const n = normalizeForMatch(text);
  if (/(כמה עולה|מחיר|עלות|כדאי|מומלץ)/.test(n)) return { intent: 'commercial', weight: 1.0 };
  if (/( או |ההבדל בין)/.test(` ${n} `))          return { intent: 'comparison', weight: 0.9 };
  return { intent: 'informational', weight: ATOM_QUERY_MAP.unspoken_want.weight };
}

// ── The engine ────────────────────────────────────────────────────────────────

const INTENT_HE: Record<TopicIntent, string> = {
  commercial:    'כוונה מסחרית (מחיר/כדאיות) — עדיפות ראשונה, עדיין מקבלת קליקים',
  transactional: 'כוונת תוצאה/שירות — זווית לעמוד שירות',
  comparison:    'כוונת השוואה — הנתיב הפתוח מול מתחרים',
  informational: 'כוונה אינפורמטיבית — היעד הוא ציטוט בתשובות AI, לא קליקים',
};

/**
 * Build the scored topic backlog from the client's living atoms (+ optional
 * verbatim VoC questions). Pure and deterministic: same inputs → same backlog.
 */
export function buildTopicBacklog(input: BuildTopicBacklogInput): ArticleTopic[] {
  const { atoms, vocQuestions = [], config = {} } = input;
  const maxPatterns = Math.max(1, config.maxPatternsPerTopic ?? DEFAULT_MAX_PATTERNS);
  const maxTopics   = Math.max(1, config.maxTopics ?? DEFAULT_MAX_TOPICS);

  const active = atoms.filter((a) => a.status === 'active');
  const business = active.filter((a) => a.layer === 'business');

  // The X slot (§1.1 "כמה עולה X"): explicit config, else the strongest
  // core_offer / real_solution business atom.
  const offerAtom =
    business.filter((a) => a.kind === 'core_offer').sort((a, b) => b.confidence - a.confidence)[0] ??
    business.filter((a) => a.kind === 'real_solution').sort((a, b) => b.confidence - a.confidence)[0];
  const offer = config.offer?.trim() || (offerAtom ? toOfferTerm(offerAtom.content) : undefined);

  const cityFromAtoms = business
    .map((a) => (typeof a.structured?.city === 'string' ? (a.structured.city as string).trim() : ''))
    .find((c) => c.length > 0);
  const city = config.city?.trim() || cityFromAtoms || undefined;

  // §1.1 last row: business atoms are the information-gain injections every
  // page needs — attached to every topic, never topics themselves.
  const injectionAtomIds = business.map((a) => a.id);

  const ctx: BuildCtx = { offer, city, maxPatterns };
  const topics: ArticleTopic[] = [];

  for (const atom of active) {
    if (atom.layer === 'business') continue;
    const mapping = ATOM_QUERY_MAP[atom.kind];
    if (!mapping) continue; // awareness/persona/bridge kinds: context, not queries
    const build = buildForKind(atom.kind, atom.content, ctx);
    if (!build) continue;

    topics.push({
      title_he:         build.title,
      query_patterns:   expandPatterns(build, maxPatterns),
      intent:           mapping.intent,
      content_type:     mapping.contentType,
      kind:             'article',
      atomIds:          [atom.id],
      injectionAtomIds,
      score:            0, // finalized below (VoC boost may apply)
      confidence:       clamp01(atom.confidence),
      voc_backed:       atom.source === 'voc',
      rationale_he:
        `אטום '${atom.kind}' (ביטחון ${clamp01(atom.confidence).toFixed(2)}): "${atom.content}" → ` +
        `${INTENT_HE[mapping.intent]}.`,
    });
  }

  // VoC questions: real customer language. A question that matches an existing
  // topic corroborates it (boost + verbatim query pattern); an unmatched one
  // becomes its own answer-first topic (§1.1 unspoken_want treatment).
  for (const q of vocQuestions) {
    const text = q.text?.trim();
    if (!text) continue;
    const nq = normalizeForMatch(text);
    if (!nq) continue;

    const match = topics.find((t) =>
      t.query_patterns.some((p) => {
        const np = normalizeForMatch(p);
        return np.length > 0 && (nq.includes(np) || np.includes(nq));
      }),
    );

    if (match) {
      match.voc_backed = true;
      match.query_patterns = dedupe([text, ...match.query_patterns]);
      match.rationale_he += ' מגובה בשאלת לקוח אמיתית מבנק הציטוטים (VoC).';
      continue;
    }

    const { intent, weight } = vocQuestionIntent(text);
    const bare = normalizeForMatch(text);
    topics.push({
      title_he:         `${bare} — התשובה המלאה`,
      query_patterns:   dedupe([text, bare, ...expandHebrewTerm(bare)]).slice(0, maxPatterns),
      intent,
      content_type:     'geo_faq_article',
      kind:             'article',
      atomIds:          [],
      injectionAtomIds,
      score:            weight, // finalized below
      confidence:       VOC_ONLY_CONFIDENCE,
      voc_backed:       true,
      rationale_he:
        `שאלת לקוח אמיתית (VoC): "${text}" — שפה אותנטית של הקהל; ${INTENT_HE[intent]}.`,
    });
  }

  // Final scoring + the commercial-intent-first ordering (weights encode it).
  for (const t of topics) {
    const weight =
      t.atomIds.length > 0
        ? ATOM_QUERY_MAP[intentSourceKind(t)]?.weight ?? 0.35
        : vocQuestionIntent(t.query_patterns[0] ?? t.title_he).weight;
    t.score = scoreTopic(weight, t.confidence, t.voc_backed);
  }

  topics.sort((a, b) => b.score - a.score || a.title_he.localeCompare(b.title_he, 'he'));
  return topics.slice(0, maxTopics);
}

/** Recover the weight key for an atom-born topic from its content type. */
function intentSourceKind(t: ArticleTopic): string {
  switch (t.content_type) {
    case 'mofu_pricing_comparison': return 'objection';
    case 'service_page_angle':      return 'desire';
    case 'comparison_page':         return 'alternative';
    case 'eeat_asset':              return 'proof';
    case 'geo_faq_article':         return 'unspoken_want';
    case 'tofu_article_faq':
    default:                        return 'pain';
  }
}
