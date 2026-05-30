// ════════════════════════════════════════════
// AI-suggested Meta targeting for an ad launch.
//
// suggestTargeting: brand/client/brief context + the approved ad copy → Claude
// proposes a valid, editable Meta targeting spec + a daily-budget suggestion.
// Interest names are resolved to Meta interest IDs via the Targeting Search API.
// toMetaTargetingSpec: convert the (possibly user-edited) suggestion into the
// exact `targeting` object Meta's ad-set endpoint expects.
// ════════════════════════════════════════════
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TargetingSuggestion } from '@/types';
import { buildAiContext } from '@/lib/ai-context';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const GRAPH = 'https://graph.facebook.com/v19.0';

const TARGETING_SYSTEM = `You are a senior Meta (Facebook/Instagram) media buyer for the Israeli market.
Given brand/client context and an approved ad, propose a realistic targeting + daily budget.

Rules:
- Default geo to Israel (country code "IL") unless the context clearly implies elsewhere.
- Pick 3-6 concrete, well-known Meta interest names (English, as they appear in Meta's interest catalog) that match the audience.
- Choose a sensible age range and gender for the offer.
- Suggest a daily budget in ILS appropriate for a small business test (typically ₪50-₪150/day).
- dailyBudget MUST be an integer in agorot (ILS minor units): e.g. ₪70/day → 7000.
- Write a one-paragraph rationale in HEBREW.

Respond with STRICT JSON only, no prose, no code fences:
{"ageMin":25,"ageMax":55,"genders":"all","geo":{"countries":["IL"]},"interests":[{"name":"..."}],"dailyBudget":7000,"rationale":"..."}`;

function parseJsonLoose<T>(text: string): T {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (t[0] !== '{' && t[0] !== '[') {
    const m = t.match(/[{[][\s\S]*[}\]]/);
    if (m) t = m[0];
  }
  return JSON.parse(t) as T;
}

export async function suggestTargeting(
  supabase: SupabaseClient,
  args: { userId: string; clientId?: string | null; approvedAdText: string; token?: string; adAccountId?: string },
): Promise<TargetingSuggestion> {
  const ctx = await buildAiContext(supabase, { userId: args.userId, clientId: args.clientId ?? null, briefId: null });
  const system = ctx.combined ? `${ctx.combined}\n\n═══ TASK ═══\n${TARGETING_SYSTEM}` : TARGETING_SYSTEM;

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 600,
    system,
    messages: [{ role: 'user', content: `Approved ad copy:\n\n${args.approvedAdText}` }],
  });
  const raw = msg.content.find(b => b.type === 'text')?.text ?? '';

  let parsed: Partial<TargetingSuggestion>;
  try {
    parsed = parseJsonLoose<Partial<TargetingSuggestion>>(raw);
  } catch {
    parsed = {};
  }

  const suggestion: TargetingSuggestion = {
    ageMin:      clampAge(parsed.ageMin, 18),
    ageMax:      clampAge(parsed.ageMax, 65),
    genders:     parsed.genders === 'male' || parsed.genders === 'female' ? parsed.genders : 'all',
    geo:         parsed.geo?.countries?.length ? parsed.geo : { countries: ['IL'] },
    interests:   Array.isArray(parsed.interests) ? parsed.interests.filter(i => i?.name).map(i => ({ name: i.name })) : [],
    dailyBudget: Number.isFinite(parsed.dailyBudget as number) && (parsed.dailyBudget as number) > 0 ? Math.round(parsed.dailyBudget as number) : 7000,
    rationale:   parsed.rationale || 'הצעת טרגוט בסיסית — ניתן לערוך לפני ההשקה.',
  };

  // Resolve interest names → Meta interest IDs when we have a token (drops unresolved).
  if (args.token) {
    suggestion.interests = await resolveInterestIds(args.token, suggestion.interests);
  }
  return suggestion;
}

function clampAge(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(65, Math.max(13, Math.round(n)));
}

/** Look up Meta interest IDs by name via Targeting Search; unresolved names are dropped. */
export async function resolveInterestIds(
  token: string,
  interests: { id?: string; name: string }[],
): Promise<{ id?: string; name: string }[]> {
  const resolved = await Promise.all(
    interests.map(async (it) => {
      if (it.id) return it;
      try {
        const url = `${GRAPH}/search?type=adinterest&q=${encodeURIComponent(it.name)}&limit=1&access_token=${encodeURIComponent(token)}`;
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        const hit = data?.data?.[0];
        return hit?.id ? { id: hit.id, name: hit.name || it.name } : null;
      } catch {
        return null;
      }
    }),
  );
  return resolved.filter(Boolean) as { id?: string; name: string }[];
}

/** Convert the (possibly user-edited) suggestion into Meta's ad-set `targeting` object. */
export function toMetaTargetingSpec(s: TargetingSuggestion): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    age_min: s.ageMin,
    age_max: s.ageMax,
    geo_locations: {
      countries: s.geo.countries?.length ? s.geo.countries : ['IL'],
      ...(s.geo.cities?.length ? { cities: s.geo.cities.map((key) => ({ key })) } : {}),
    },
  };
  if (s.genders === 'male')   spec.genders = [1];
  if (s.genders === 'female') spec.genders = [2];
  const interests = s.interests.filter(i => i.id).map(i => ({ id: i.id, name: i.name }));
  if (interests.length) spec.interests = interests;
  return spec;
}
