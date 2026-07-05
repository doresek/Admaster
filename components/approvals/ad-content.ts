// components/approvals/ad-content.ts
// Pure normalizer for the `approvals.content` jsonb payload.
// Two shapes exist in prod today and both MUST render:
//   manual   (dashboard create): { text, image_url }
//   autopilot (lib/autopilot/steps.ts): { post, hashtags, wa, image_prompt,
//                                         framework, score, judge }
// Newer rows (created via /api/approvals POST) may additionally carry
// snapshotted fields: { client_name, grounding: [{id, content, ...}],
//                       audience, budget, cta }.
// Everything is optional — degrade gracefully, never crash on a shape.

export interface GroundingAtom {
  id: string;
  content: string | null;
  confidence?: number | null;
  layer?: string | null;
}

export interface NormalizedAd {
  /** The post body (manual `text` or autopilot `post`). */
  text: string;
  /** A real creative image URL, when one exists. */
  imageUrl: string | null;
  /** The image prompt, when only a prompt exists (no rendered image yet). */
  imagePrompt: string | null;
  hashtags: string[];
  cta: string | null;
  /** Audience in plain words (string only — raw objects are summarized or dropped). */
  audience: string | null;
  /** Human-readable budget line, when the ad is paid. */
  budget: string | null;
  /** Snapshotted client name (business the ad represents). */
  clientName: string | null;
  /** Snapshotted grounded atoms (the WHY). */
  grounding: GroundingAtom[];
  /** Autopilot judge rationale — honest AI-assessment fallback when no grounding. */
  judgeRationale: string | null;
  /** Practical AI score 0-100, when present. */
  score: number | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function formatBudget(b: unknown): string | null {
  if (b == null) return null;
  if (typeof b === 'number' && Number.isFinite(b)) return `₪${b.toLocaleString('he-IL')}`;
  if (typeof b === 'string') return str(b);
  if (typeof b === 'object') {
    const o = b as Record<string, unknown>;
    const daily = o.daily ?? o.daily_budget;
    const amount = daily ?? o.amount ?? o.total;
    if (typeof amount === 'number' && Number.isFinite(amount)) {
      const cur = typeof o.currency === 'string' && o.currency && o.currency !== 'ILS' ? ` ${o.currency}` : '';
      const sign = cur ? '' : '₪';
      return `${sign}${amount.toLocaleString('he-IL')}${cur}${daily != null ? ' ליום' : ''}`;
    }
  }
  return null;
}

function formatAudience(c: Record<string, unknown>): string | null {
  const direct = str(c.audience) ?? str(c.target_audience);
  if (direct) return direct;
  const t = c.targeting;
  if (typeof t === 'string') return str(t);
  if (t && typeof t === 'object') {
    const o = t as Record<string, unknown>;
    return str(o.summary) ?? str(o.description) ?? str(o.audience);
  }
  return null;
}

function normalizeGrounding(g: unknown): GroundingAtom[] {
  if (!Array.isArray(g)) return [];
  const out: GroundingAtom[] = [];
  for (const item of g) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const content = str(o.content);
    if (!content) continue;
    out.push({
      id: typeof o.id === 'string' ? o.id : '',
      content,
      confidence: typeof o.confidence === 'number' ? o.confidence : null,
      layer: typeof o.layer === 'string' ? o.layer : null,
    });
  }
  return out;
}

export function normalizeAdContent(raw: unknown): NormalizedAd {
  const empty: NormalizedAd = {
    text: '', imageUrl: null, imagePrompt: null, hashtags: [], cta: null,
    audience: null, budget: null, clientName: null, grounding: [],
    judgeRationale: null, score: null,
  };
  if (typeof raw === 'string') return { ...empty, text: raw };
  if (!raw || typeof raw !== 'object') return empty;
  const c = raw as Record<string, unknown>;

  const judge = c.judge && typeof c.judge === 'object' ? (c.judge as Record<string, unknown>) : null;

  return {
    text: str(c.text) ?? str(c.post) ?? '',
    imageUrl: str(c.image_url) ?? str(c.imageUrl),
    imagePrompt: str(c.image_prompt) ?? str(c.imagePrompt),
    hashtags: Array.isArray(c.hashtags) ? c.hashtags.filter((h): h is string => typeof h === 'string' && !!h.trim()) : [],
    cta: str(c.cta),
    audience: formatAudience(c),
    budget: formatBudget(c.budget),
    clientName: str(c.client_name) ?? str(c.clientName),
    grounding: normalizeGrounding(c.grounding),
    judgeRationale: judge ? str(judge.rationale) : null,
    score: typeof c.score === 'number' && Number.isFinite(c.score) ? c.score : null,
  };
}

/** One-line grounded WHY: "המודעה נבנתה סביב …" — null when no grounding snapshot. */
export function groundingLine(ad: NormalizedAd): string | null {
  const parts = ad.grounding.map((g) => (g.content ?? '').trim()).filter(Boolean).slice(0, 3);
  if (!parts.length) return null;
  return `המודעה נבנתה סביב ${parts.join(' · ')}`;
}

/** First non-empty line of the post — for list thumbnails. */
export function firstLine(ad: NormalizedAd): string {
  const line = ad.text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}
