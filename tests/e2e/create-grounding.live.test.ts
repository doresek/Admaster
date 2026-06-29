// ════════════════════════════════════════════════════════════════
// LIVE E2E: /create brief-grounding wiring (feat/create-uses-brief)
//
// Verifies the brief+avatar grounding END-TO-END, not just the chip UI:
//   1. GREEN chip  — brief-backed client active → "✓ מבוסס על הבריף של…",
//      and the POST to /api/ai/master carries client_id + brief_id.
//   2. AMBER chip  — no active client → "…ייווצר מהטקסט בלבד" + /briefs
//      link, and generation still fires (no client_id required).
//   3. GROUNDING REACHES THE MODEL — the real regression guard: with a
//      brief-backed client, buildAiContext yields non-empty briefText and
//      the assembled strategist system prompt (exactly as the route builds
//      it) contains BOTH the grounding block AND the seeded brief/avatar
//      content. No Anthropic call (fast + deterministic).
//
// Drives the REAL UI with Playwright (chromium) against a locally-running
// build of THIS branch, plus a direct DB check via service role. Touches
// real data (seeds + deletes one brief), so it is gated and never runs in
// the normal `npm test` suite.
//
// Run:
//   1. next dev (or build && start) on feat/create-uses-brief, e.g.
//        set -a; source .env.local; set +a; npm run dev
//   2. RUN_E2E=1 E2E_BASE_URL=http://localhost:3000 \
//        npx vitest run tests/e2e/create-grounding.live.test.ts
// ════════════════════════════════════════════════════════════════
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { readFileSync } from 'fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { PostgrestClient } from '@supabase/postgrest-js';
import { buildAiContext } from '@/lib/ai-context';
import { composeStrategistPrompt } from '@/lib/master-studio/strategist';
import type { MasterStudioInput } from '@/lib/master-studio';

const RUN = process.env.RUN_E2E === '1';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

// Admin test account (provided)
const EMAIL = 'elirankahalani27@gmail.com';
const PW    = 'admin12345';

// Known live data (admin-owned). Seed client = "mg kosher trips".
const ADMIN_USER_ID = 'bfc4a212-6efe-4193-96fd-69055f843658';
const SEED_CLIENT_ID = 'f6832c23-1c98-43d6-b8a7-f7452db74821';
const SEED_CLIENT_NAME = 'mg kosher trips';
const SEED_CODE = 'YSON9D'; // existing brief_code for this client (brief_codes_client_uniq)

// Unique markers we can assert flow through into the model prompt.
const BIZ_MARKER = 'E2EBIZMARK';
const AVATAR_MARKER = 'E2EAVATARMARK';

// Load .env.local so the DB checks have credentials even when not exported.
function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf8')
        .split('\n')
        .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
        .map(l => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        }),
    );
  } catch { return {}; }
}
const ENV = { ...loadEnv(), ...process.env };
const SUPABASE_URL = ENV.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = ENV.SUPABASE_SERVICE_ROLE_KEY!;

function db(): PostgrestClient {
  return new PostgrestClient(`${SUPABASE_URL}/rest/v1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

// Minimal valid MasterV2Output so the page renders without crashing when we
// mock the generate response (tests 1).
const MOCK_OUTPUT = {
  avatar: { persona: 'p', fears: 'f', desires: 'd', awareness_level: '3', objections: 'o' },
  marketers: [{ id: 'ogilvy', name: 'David Ogilvy', emoji: '🎩', why: '' }],
  winner: {
    marketer: { id: 'ogilvy', name: 'David Ogilvy', emoji: '🎩', why: '' },
    draft: { post: 'מוק פוסט', whatsapp: 'wa', image: 'img', hashtags: ['#a'], tips: 'tips', principles: [] },
    score: 85,
  },
  scores: [{ index: 0, score: 85 }],
  judgeRationale: 'because',
  boosted: false,
};

let browser: Browser;
let ctx: BrowserContext;
let page: Page;
let seededBriefId: string;

async function login(p: Page) {
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.getByPlaceholder('you@example.com').fill(EMAIL);
  await p.getByPlaceholder('••••••••').fill(PW);
  await p.getByRole('button', { name: /כניסה/ }).click();
  await p.waitForURL(u => new URL(u).pathname === '/', { timeout: 45_000 });
}

describe.skipIf(!RUN)('create /create brief-grounding (LIVE E2E)', () => {
  beforeAll(async () => {
    // ── Seed a grounding-eligible brief for the admin's client ──
    const rest = db();
    // idempotent: clear any prior seeded brief for this code+user
    await rest.from('briefs').delete().eq('code', SEED_CODE).eq('user_id', ADMIN_USER_ID);
    const { data, error } = await rest
      .from('briefs')
      .insert({
        code: SEED_CODE,
        user_id: ADMIN_USER_ID,
        client_id: SEED_CLIENT_ID,
        status: 'complete',
        values: {
          biz_name: SEED_CLIENT_NAME,
          biz_what: `טיולים כשרים מהדרין ליעדים אקזוטיים ${BIZ_MARKER}`,
          cust_who: 'משפחות שומרות מצוות',
          pain_internal: 'חשש שלא יהיה אוכל כשר אמין בחו"ל',
          desire_dream: 'חופשה רגועה בלי דאגות כשרות',
        },
        avatar: `קהל היעד: משפחות דתיות מהמרכז, גיל 30-50 ${AVATAR_MARKER}`,
      })
      .select('id')
      .single();
    if (error) throw new Error(`seed failed: ${JSON.stringify(error)}`);
    seededBriefId = data!.id;

    browser = await chromium.launch();
    ctx = await browser.newContext({ baseURL: BASE });
    page = await ctx.newPage();
    await login(page);
  }, 120_000);

  afterAll(async () => {
    if (seededBriefId) await db().from('briefs').delete().eq('id', seededBriefId);
    await browser?.close();
  });

  // ── Test 1: GREEN chip + payload carries client_id + brief_id ──
  it('green chip renders and generate payload includes client_id + brief_id', async () => {
    await ctx.addCookies([{ name: 'admaster_active_client', value: SEED_CLIENT_ID, url: BASE }]);

    let captured: any = null;
    await page.route('**/api/ai/master', async route => {
      captured = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_OUTPUT) });
    });
    // avoid the follow-up score call hitting the real endpoint
    await page.route('**/api/ai/score', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));

    await page.goto(`${BASE}/create`, { waitUntil: 'domcontentloaded' });

    const chip = page.getByText(/מבוסס על הבריף של/);
    await chip.waitFor({ state: 'visible', timeout: 20_000 });
    expect(await chip.innerText()).toContain(SEED_CLIENT_NAME);

    await page.getByPlaceholder('מבצע סוף עונה, השקת מוצר…').fill('מבצע סוף עונה לטיולים');
    await page.getByRole('button', { name: /צור פוסט/ }).click();
    await page.waitForResponse(r => r.url().includes('/api/ai/master'), { timeout: 20_000 });

    expect(captured).toBeTruthy();
    expect(captured.client_id).toBe(SEED_CLIENT_ID);
    expect(captured.brief_id).toBe(seededBriefId);

    await page.unroute('**/api/ai/master');
    await page.unroute('**/api/ai/score');
  }, 90_000);

  // ── Test 2: AMBER fallback + generation still works without a client ──
  it('amber chip + /briefs link when no client, and generation still fires', async () => {
    // Overwrite the active-client cookie with a non-UUID so the server treats
    // it as "no active client" (readActiveClientCookie rejects non-UUIDs).
    await ctx.addCookies([{ name: 'admaster_active_client', value: 'none', url: BASE }]);

    let captured: any = null;
    await page.route('**/api/ai/master', async route => {
      captured = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_OUTPUT) });
    });
    await page.route('**/api/ai/score', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));

    await page.goto(`${BASE}/create`, { waitUntil: 'domcontentloaded' });

    const amber = page.getByText(/ייווצר מהטקסט בלבד/);
    await amber.waitFor({ state: 'visible', timeout: 20_000 });

    // Scope to main content so we don't match the sidebar's "📝 בריפים" nav link.
    const briefsLink = page.getByRole('main').getByRole('link', { name: /לבריפים|צור בריף/ });
    expect(await briefsLink.getAttribute('href')).toBe('/briefs');

    // Generation must still proceed (no client required).
    await page.getByPlaceholder('מבצע סוף עונה, השקת מוצר…').fill('טיפ שיווקי כללי');
    await page.getByRole('button', { name: /צור פוסט/ }).click();
    await page.waitForResponse(r => r.url().includes('/api/ai/master'), { timeout: 20_000 });
    // The winning post renders → the flow completed end-to-end without a client.
    await page.getByText('מוק פוסט').waitFor({ state: 'visible', timeout: 15_000 });

    expect(captured).toBeTruthy();
    expect(captured.client_id).toBeUndefined();
    expect(captured.brief_id).toBeUndefined();

    await page.unroute('**/api/ai/master');
    await page.unroute('**/api/ai/score');
  }, 90_000);

  // ── Test 3: grounding actually reaches the model prompt (the real guard) ──
  it('buildAiContext yields non-empty briefText and the strategist prompt carries brief+avatar', async () => {
    const rest = db();
    const aiCtx = await buildAiContext(rest as any, {
      userId: ADMIN_USER_ID,
      clientId: SEED_CLIENT_ID,
      briefId: seededBriefId,
    });

    // The brief was loaded and formatted (not empty).
    expect(aiCtx.briefText).not.toBe('');
    expect(aiCtx.clientText).toContain(SEED_CLIENT_NAME);
    expect(aiCtx.combined).toContain(BIZ_MARKER);                 // structured value flowed in
    expect(aiCtx.combined).toContain('Saved customer avatar');    // avatar section present
    expect(aiCtx.combined).toContain(AVATAR_MARKER);              // avatar content flowed in

    // Assemble the strategist system prompt EXACTLY as app/api/ai/master/route.ts does.
    const ctxPrefix = aiCtx.combined ? `${aiCtx.combined}\n\n═══ TASK ═══\n` : '';
    const input: MasterStudioInput = {
      brief: 'מבצע סוף עונה לטיולים',
      masterNotes: '',
      platform: 'Facebook',
      tone: 'חם ואישי',
      type: 'מבצע',
      locale: 'he',
    };
    const sp = composeStrategistPrompt(input);
    const system = ctxPrefix + sp.system;

    // The grounding instruction AND the real client brief/avatar are both in
    // the system prompt the model receives.
    expect(system).toContain('GROUNDING (מקור אמת)');
    expect(system).toContain(BIZ_MARKER);
    expect(system).toContain(AVATAR_MARKER);
    // Free-text is framed as the specific post topic, not the business.
    expect(sp.user).toBe('נושא הפוסט הספציפי: מבצע סוף עונה לטיולים');
  }, 30_000);
});
