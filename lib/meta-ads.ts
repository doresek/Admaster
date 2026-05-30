// ════════════════════════════════════════════
// Meta Ads Launcher — the Graph API ad chain.
//
// Turns a client-approved creative into a complete, PAUSED Facebook ad:
//   upload image → build object_story_spec → (preview) → campaign → ad set →
//   creative → ad. All objects are created PAUSED; the caller can flip to ACTIVE.
//
// Pure-ish: these talk to Graph directly with a decrypted token (the route layer
// owns auth/credits/persistence). buildObjectStorySpec / destinationToObjective /
// toCallToAction are pure and unit-tested.
// ════════════════════════════════════════════
import dns from 'node:dns/promises';
import net from 'node:net';
import type { Destination, DestinationType, MetaCampaignObjective } from '@/types';

const GRAPH = 'https://graph.facebook.com/v19.0';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB cap on fetched creatives

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/**
 * SSRF guard: the image URL comes from user-supplied approval content, so before
 * the server fetches it we require https and reject hosts that resolve to private
 * / loopback / link-local ranges (cloud metadata, internal services, localhost).
 */
async function assertSafeImageUrl(raw: string): Promise<void> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('כתובת תמונה לא תקינה'); }
  if (u.protocol !== 'https:') throw new Error('כתובת התמונה חייבת להיות https');
  if (/^(localhost|0\.0\.0\.0|\[?::1\]?)$/i.test(u.hostname)) throw new Error('כתובת תמונה לא מורשית');
  let resolved: { address: string }[];
  try { resolved = await dns.lookup(u.hostname, { all: true }); }
  catch { throw new Error('לא ניתן לאמת את כתובת התמונה'); }
  if (resolved.some(r => isPrivateIp(r.address))) throw new Error('כתובת תמונה לא מורשית');
}

// ─── Graph helper ────────────────────────────────────────
async function graph(path: string, token: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: object) {
  const isGet = method === 'GET';
  const url = isGet
    ? `${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`
    : `${GRAPH}/${path}`;
  const res = await fetch(url, {
    method,
    headers: isGet ? undefined : { 'Content-Type': 'application/json' },
    body: isGet ? undefined : JSON.stringify({ access_token: token, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.error) {
    const e = data.error;
    throw new Error(e.error_user_msg || e.message || `Graph error (${res.status})`);
  }
  return data;
}

/** Ad-account ids are addressed as `act_<id>` in Graph paths. */
function actId(adAccountId: string): string {
  return adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
}

// ─── Destination → objective / CTA / optimization mapping ─

const DESTINATION_CONFIG: Record<DestinationType, {
  objective: MetaCampaignObjective;
  optimizationGoal: string;
  defaultCta: string;
  needsPromotedPage: boolean;
}> = {
  landing_page: { objective: 'OUTCOME_TRAFFIC',    optimizationGoal: 'LINK_CLICKS',     defaultCta: 'LEARN_MORE',       needsPromotedPage: false },
  external_url: { objective: 'OUTCOME_TRAFFIC',    optimizationGoal: 'LINK_CLICKS',     defaultCta: 'LEARN_MORE',       needsPromotedPage: false },
  whatsapp:     { objective: 'OUTCOME_ENGAGEMENT', optimizationGoal: 'CONVERSATIONS',   defaultCta: 'WHATSAPP_MESSAGE', needsPromotedPage: true },
  lead_form:    { objective: 'OUTCOME_LEADS',      optimizationGoal: 'LEAD_GENERATION', defaultCta: 'SIGN_UP',          needsPromotedPage: true },
};

export function destinationToObjective(type: DestinationType): MetaCampaignObjective {
  return DESTINATION_CONFIG[type].objective;
}

export function defaultCtaFor(type: DestinationType): string {
  return DESTINATION_CONFIG[type].defaultCta;
}

/** Resolve a destination to the concrete link used in the creative. */
export function destinationLink(destination: Destination, appUrl: string): string {
  switch (destination.type) {
    case 'landing_page': return `${appUrl.replace(/\/$/, '')}/lp/${destination.value}`;
    case 'external_url': return destination.value;
    case 'whatsapp':     return `https://wa.me/${destination.value.replace(/[^0-9]/g, '')}`;
    case 'lead_form':    return 'https://www.facebook.com';
  }
}

// ─── object_story_spec builder (pure) ────────────────────

export interface StorySpecInput {
  pageId:      string;
  headline:    string;
  primaryText: string;
  description?: string;
  destination: Destination;
  imageHash:   string;
  link:        string;       // pre-resolved via destinationLink()
  cta?:        string;       // override; else destination default
}

export function buildObjectStorySpec(input: StorySpecInput): Record<string, unknown> {
  const ctaType = input.cta || defaultCtaFor(input.destination.type);

  const callToAction: Record<string, unknown> =
    input.destination.type === 'lead_form'
      ? { type: ctaType, value: { lead_gen_form_id: input.destination.value } }
      : input.destination.type === 'whatsapp'
      ? { type: ctaType, value: { app_destination: 'WHATSAPP', link: input.link } }
      : { type: ctaType, value: { link: input.link } };

  return {
    page_id: input.pageId,
    link_data: {
      message:     input.primaryText,
      name:        input.headline,
      description: input.description || undefined,
      link:        input.link,
      image_hash:  input.imageHash,
      call_to_action: callToAction,
    },
  };
}

// ─── Graph operations ────────────────────────────────────

/** Upload image bytes to the ad account; returns the image_hash for the creative. */
export async function uploadAdImage(token: string, adAccountId: string, imageUrl: string): Promise<{ imageHash: string }> {
  await assertSafeImageUrl(imageUrl);
  const imgRes = await fetch(imageUrl, { redirect: 'error' }); // no redirects → no SSRF bypass via 3xx
  if (!imgRes.ok) throw new Error('לא ניתן להוריד את התמונה ליצירת המודעה');
  const ct = imgRes.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) throw new Error('הכתובת אינה מצביעה על תמונה');
  const buf = Buffer.from(await imgRes.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error('התמונה גדולה מדי (מקסימום 12MB)');
  const base64 = buf.toString('base64');
  const data = await graph(`${actId(adAccountId)}/adimages`, token, 'POST', { bytes: base64 });
  // Response shape: { images: { <key>: { hash, url } } } — take the first entry.
  const first = data?.images && (Object.values(data.images)[0] as { hash?: string } | undefined);
  if (!first?.hash) throw new Error('Meta לא החזיר image_hash להעלאת התמונה');
  return { imageHash: first.hash };
}

/** Render a real Meta ad preview (iframe HTML) for a story spec. */
export async function generatePreview(
  token: string,
  adAccountId: string,
  objectStorySpec: Record<string, unknown>,
  adFormat = 'MOBILE_FEED_STANDARD',
): Promise<{ previewHtml: string }> {
  const creative = JSON.stringify({ object_story_spec: objectStorySpec });
  const data = await graph(
    `${actId(adAccountId)}/generatepreviews?ad_format=${adFormat}&creative=${encodeURIComponent(creative)}`,
    token,
  );
  const body = data?.data?.[0]?.body;
  if (!body) throw new Error('Meta לא החזיר תצוגה מקדימה');
  return { previewHtml: body };
}

export interface LaunchInput {
  pageId:           string;
  campaignName:     string;
  destinationType:  DestinationType;
  dailyBudget:      number;            // account-currency minor units
  targeting:        Record<string, unknown>;
  objectStorySpec:  Record<string, unknown>;
}

export interface LaunchResult {
  campaignId: string;
  adSetId:    string;
  creativeId: string;
  adId:       string;
}

/**
 * Create campaign → ad set → creative → ad, all PAUSED.
 * On any mid-chain failure, best-effort delete the campaign (cascades) so no
 * orphaned PAUSED objects linger, then rethrow a structured error.
 */
export async function launchFullCampaign(token: string, adAccountId: string, input: LaunchInput): Promise<LaunchResult> {
  const cfg = DESTINATION_CONFIG[input.destinationType];
  const acc = actId(adAccountId);
  let campaignId: string | undefined;

  try {
    const campaign = await graph(`${acc}/campaigns`, token, 'POST', {
      name: input.campaignName,
      objective: cfg.objective,
      status: 'PAUSED',
      special_ad_categories: [],
    });
    campaignId = campaign.id;

    const adSetBody: Record<string, unknown> = {
      name: `${input.campaignName} — Ad Set`,
      campaign_id: campaignId,
      daily_budget: input.dailyBudget,
      billing_event: 'IMPRESSIONS',
      optimization_goal: cfg.optimizationGoal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: input.targeting,
      status: 'PAUSED',
    };
    if (cfg.needsPromotedPage) adSetBody.promoted_object = { page_id: input.pageId };

    const adSet = await graph(`${acc}/adsets`, token, 'POST', adSetBody);

    const creative = await graph(`${acc}/adcreatives`, token, 'POST', {
      name: `${input.campaignName} — Creative`,
      object_story_spec: input.objectStorySpec,
    });

    const ad = await graph(`${acc}/ads`, token, 'POST', {
      name: input.campaignName,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED',
    });

    return { campaignId: campaignId!, adSetId: adSet.id, creativeId: creative.id, adId: ad.id };
  } catch (err: any) {
    // Roll back the half-built campaign so we don't leave orphans.
    if (campaignId) {
      await graph(campaignId, token, 'DELETE').catch(() => {});
    }
    throw new Error(err.message || 'יצירת המודעה ב-Meta נכשלה');
  }
}

/** Flip a campaign (and its children) between PAUSED and ACTIVE. */
export async function setCampaignStatus(token: string, campaignId: string, status: 'ACTIVE' | 'PAUSED') {
  return graph(campaignId, token, 'POST', { status });
}

/** Preflight: confirm the token has the scopes we need before spending a credit. */
export async function checkAdScopes(token: string): Promise<{ ok: boolean; missing: string[] }> {
  const required = ['ads_management', 'pages_manage_ads'];
  try {
    const data = await graph('me/permissions', token);
    const granted = new Set(
      (data?.data || []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission),
    );
    const missing = required.filter(p => !granted.has(p));
    return { ok: missing.length === 0, missing };
  } catch {
    // If the permissions probe itself fails, don't hard-block — surface at launch.
    return { ok: true, missing: [] };
  }
}
