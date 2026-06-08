// Characterization tests for the IMAGES feature (generated_images).
//
// These lock in what the code does TODAY (warts included), not what we may
// want later. Companion to tests/landing-leads.test.ts; same strategy: drive
// the REAL route handler with a mocked Supabase client + mocked image libs and
// assert the exact insert payloads. Where a path is too coupled, see the
// COUPLING FINDINGS block at the bottom.
//
// Verified-against-source schema facts this file locks
// (generated_images, across migrations):
//   002_features.sql:43-53        id, user_id(FK users,NOT NULL), prompt, image_url,
//                                  provider(def 'ideogram'), style, aspect_ratio(def '1:1'),
//                                  used_in, created_at
//   003_messages_and_series.sql   + parent_image_id (self-FK, on delete set null), edit_prompt
//   007_image_pipeline.sql        + candidate_urls (jsonb '[]'), judge_rationale, is_smart (bool)
//   003_security_hardening.sql:53 RLS "images_all_own": for all using auth.uid()=user_id
//
//   ► There is NO client_id column on generated_images, and NO FK to meta_clients.
//     (Contrast landing_pages, which HAS a nullable client_id; and generated_content,
//      which gained client_id in 004_phase_b. generated_images got neither.)
//     So image→client attribution is not merely null-by-default — it is impossible
//     at the schema level today.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// ── Shared, hoisted, mutable test state ─────────────────────────────
const H = vi.hoisted(() => ({
  cfg: {
    authUser:      { id: 'owner-1' } as { id: string } | null,
    rateOk:        true,
    deductSuccess: true,
    listRows:      [] as any[],
  },
  captured: {
    imageInsert:   undefined as any,
    pipelineInput: undefined as any,
    rpcCalls:      [] as Array<{ name: string; args: any }>,
  },
  // Canned best-of-N pipeline result the smart path consumes.
  pipelineResult: {
    winner:     { index: 1, prompt: 'WIN PROMPT', url: 'https://img/win.png', concept: 'c1' },
    candidates: [
      { index: 0, url: 'https://img/0.png', concept: 'c0', prompt: 'p0' },
      { index: 1, url: 'https://img/win.png', concept: 'c1', prompt: 'WIN PROMPT' },
      { index: 2, url: 'https://img/2.png', concept: 'c2', prompt: 'p2' },
    ],
    judge: { winnerIndex: 1, rationale: 'הזוכה ברור', scores: [{ index: 0, total: 70 }, { index: 1, total: 95 }, { index: 2, total: 80 }] },
    brief: {},
    partial: false,
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: H.cfg.authUser } }) },
    rpc: (name: string, args: any) => {
      H.captured.rpcCalls.push({ name, args });
      if (name === 'deduct_credits') {
        return Promise.resolve({ data: H.cfg.deductSuccess ? { success: true, credits: 42 } : { success: false } });
      }
      return Promise.resolve({ data: {} });
    },
    from(_table: string) {
      const builder: any = {
        select: () => builder,
        eq:     () => builder,
        order:  () => builder,
        // GET list terminates on .limit(n)
        limit:  async () => ({ data: H.cfg.listRows }),
        // POST inserts are awaited directly (no .select() chain)
        insert: async (payload: any) => { H.captured.imageInsert = payload; return { error: null }; },
      };
      return builder;
    },
  }),
}));

// Image-gen libs — keep all generation off the network.
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ ok: H.cfg.rateOk, retryAfter: 30 }) }));
vi.mock('@/lib/vertex-ai', () => ({
  callVertexImageGen: async () => ({ base64: 'AAAA', mimeType: 'image/png' }),
  GEMINI_ASPECT: { ASPECT_1_1: '1:1', ASPECT_16_9: '16:9', ASPECT_9_16: '9:16' } as Record<string, string>,
}));
vi.mock('@/lib/image-storage', () => ({ uploadToStorage: async () => 'https://stored/img.png' }));
vi.mock('@/lib/image-pipeline', () => ({
  runImagePipeline: async (input: any) => { H.captured.pipelineInput = input; return H.pipelineResult; },
}));

function fakeReq(body: any, headers: Record<string, string> = {}): any {
  return {
    url: 'http://localhost/api/images',
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  };
}

beforeAll(() => {
  // Enables the gemini path (generateGemini gated on this) + makes gemini the default provider.
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

beforeEach(() => {
  H.cfg.authUser      = { id: 'owner-1' };
  H.cfg.rateOk        = true;
  H.cfg.deductSuccess = true;
  H.cfg.listRows      = [];
  H.captured.imageInsert   = undefined;
  H.captured.pipelineInput = undefined;
  H.captured.rpcCalls      = [];
});

afterEach(() => { vi.unstubAllGlobals(); });

// ════════════════════════════════════════════════════════════════════
// 1. Single-shot fresh generation — insert shape (real handler)
// ════════════════════════════════════════════════════════════════════
describe('POST /api/images — single-shot insert shape (real handler)', () => {
  it('inserts owner-scoped row with NO client_id; parent/edit fields null on a fresh gen', async () => {
    const { POST } = await import('@/app/api/images/route');
    const res = await POST(fakeReq({ smart: false, prompt: 'a cat in a hat', aspectRatio: 'ASPECT_1_1', style: 'REALISTIC' }));

    expect(res.status).toBe(200);
    expect(H.captured.imageInsert).toEqual({
      user_id:         'owner-1',
      prompt:          'a cat in a hat',
      image_url:       'https://stored/img.png',
      provider:        'gemini',          // default provider (GOOGLE_SERVICE_ACCOUNT_JSON set)
      style:           'REALISTIC',
      aspect_ratio:    'ASPECT_1_1',
      parent_image_id: null,
      edit_prompt:     null,
    });
    // The attribution gap, locked: no client linkage is written (no column exists).
    expect('client_id' in H.captured.imageInsert).toBe(false);
  });

  it('row is attributed to the authenticated owner (user_id), nothing else', async () => {
    H.cfg.authUser = { id: 'agency-77' };
    const { POST } = await import('@/app/api/images/route');
    await POST(fakeReq({ smart: false, prompt: 'x' }));
    expect(H.captured.imageInsert.user_id).toBe('agency-77');
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Edit mode — locks the edit-chain columns (parent_image_id, edit_prompt)
//    Source-image fetch is stubbed so no network is touched.
// ════════════════════════════════════════════════════════════════════
describe('POST /api/images mode=edit — edit-chain insert shape (real handler)', () => {
  it('persists parent_image_id + edit_prompt + tagged prompt; still NO client_id', async () => {
    // generateGemini fetches the source image when editing — stub it.
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
      headers: { get: () => 'image/png' },
    }));

    const { POST } = await import('@/app/api/images/route');
    const res = await POST(fakeReq({
      mode: 'edit', editPrompt: 'make it blue',
      parentImageId: 'img-1', parentImageUrl: 'https://src/old.png',
      provider: 'gemini', aspectRatio: 'ASPECT_1_1', style: 'REALISTIC',
    }));

    expect(res.status).toBe(200);
    expect(H.captured.imageInsert.parent_image_id).toBe('img-1');
    expect(H.captured.imageInsert.edit_prompt).toBe('make it blue');
    expect(H.captured.imageInsert.prompt).toBe('[edit] make it blue'); // promptTag prefix
    expect('client_id' in H.captured.imageInsert).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Smart pipeline — the strongest attribution finding
//    The route DOES resolve a clientId and threads it into runImagePipeline,
//    but the persisted generated_images row drops it (no column to hold it).
// ════════════════════════════════════════════════════════════════════
describe('POST /api/images smart — pipeline insert shape (real handler)', () => {
  it('writes candidate_urls/judge_rationale/is_smart, and the known clientId is DROPPED at persistence', async () => {
    const { POST } = await import('@/app/api/images/route');
    const res = await POST(fakeReq({
      smart: true, adCopy: 'מבצע קיץ', aspectRatio: 'ASPECT_1_1', style: 'REALISTIC',
      client_id: 'client-9',
    }));

    expect(res.status).toBe(200);

    // The route KNEW the client and passed it down the pipeline …
    expect(H.captured.pipelineInput.clientId).toBe('client-9');

    // … yet the row it saved has no client reference at all.
    expect(H.captured.imageInsert).toEqual({
      user_id:         'owner-1',
      prompt:          'WIN PROMPT',
      image_url:       'https://img/win.png',
      provider:        'gemini',
      style:           'REALISTIC',
      aspect_ratio:    'ASPECT_1_1',
      candidate_urls:  [
        { url: 'https://img/0.png', concept: 'c0', total: 70 },
        { url: 'https://img/2.png', concept: 'c2', total: 80 },
      ],
      judge_rationale: 'הזוכה ברור',
      is_smart:        true,
    });
    expect('client_id' in H.captured.imageInsert).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Guards — none of these reach an insert
// ════════════════════════════════════════════════════════════════════
describe('POST /api/images — guards short-circuit before any insert', () => {
  it('unauthenticated → 401, no insert', async () => {
    H.cfg.authUser = null;
    const { POST } = await import('@/app/api/images/route');
    const res = await POST(fakeReq({ prompt: 'x' }));
    expect(res.status).toBe(401);
    expect(H.captured.imageInsert).toBeUndefined();
  });

  it('rate-limited → 429, no insert', async () => {
    H.cfg.rateOk = false;
    const { POST } = await import('@/app/api/images/route');
    const res = await POST(fakeReq({ prompt: 'x' }));
    expect(res.status).toBe(429);
    expect(H.captured.imageInsert).toBeUndefined();
  });

  it('insufficient credits → 402, no insert', async () => {
    H.cfg.deductSuccess = false;
    const { POST } = await import('@/app/api/images/route');
    const res = await POST(fakeReq({ smart: false, prompt: 'x' }));
    expect(res.status).toBe(402);
    expect(H.captured.imageInsert).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. GET /api/images — list scoping (real handler)
// ════════════════════════════════════════════════════════════════════
describe('GET /api/images — owner-scoped history', () => {
  it('returns the rows the (user_id-scoped, limit 50) query yields', async () => {
    H.cfg.listRows = [{ id: 'i1' }, { id: 'i2' }];
    const { GET } = await import('@/app/api/images/route');
    const res = await GET();
    expect(await res.json()).toEqual([{ id: 'i1' }, { id: 'i2' }]);
  });

  it('unauthenticated → 401', async () => {
    H.cfg.authUser = null;
    const { GET } = await import('@/app/api/images/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. ATTRIBUTION MODEL — "images per client" is not computable today.
//    Unlike leads (a two-hop chain through landing_pages.client_id), a
//    generated_images row has NO field that references a client. The only
//    association fields are user_id (owner), parent_image_id (self, edit chain)
//    and used_in (free text). This block locks that data reality.
// ════════════════════════════════════════════════════════════════════
type ImageRow = {
  id: string; user_id: string;
  parent_image_id: string | null; used_in: string | null;
  // note: intentionally NO client_id — mirrors the real table
};

// Best-effort attempt to bucket images by client. There is no client key, so
// every row necessarily lands in the "no client field" bucket.
function imagesPerClient(rows: ImageRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const clientId = (r as any).client_id ?? null; // the field simply does not exist
    const bucket = clientId ?? '__no_client_field__';
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

describe('attribution model: generated_images has no client linkage', () => {
  it('every image falls into the "no client field" bucket — attribution is impossible today', () => {
    const rows: ImageRow[] = [
      { id: 'i1', user_id: 'u1', parent_image_id: null,  used_in: null },
      { id: 'i2', user_id: 'u1', parent_image_id: 'i1',  used_in: 'landing' },
      { id: 'i3', user_id: 'u1', parent_image_id: null,  used_in: null },
    ];
    expect(imagesPerClient(rows)).toEqual({ __no_client_field__: 3 });
  });

  it('a client_id added to a row would be honored — but the schema provides no such column (latent only after a migration)', () => {
    // Demonstrates the shape a future migration would need to enable attribution.
    const withClient = [{ id: 'i1', user_id: 'u1', parent_image_id: null, used_in: null, client_id: 'client-A' }] as any;
    expect(imagesPerClient(withClient)).toEqual({ 'client-A': 1 });
  });
});

// ════════════════════════════════════════════════════════════════════
// COUPLING FINDINGS — paths intentionally NOT driven here
// ════════════════════════════════════════════════════════════════════
// (a) /api/quick-campaign (route.ts:133) inserts generated_images
//     {user_id, prompt, image_url, provider:'ideogram', style:'REALISTIC',
//      aspect_ratio:'ASPECT_1_1'} — NO client_id. Reached only after an Anthropic
//     copy-gen call + an Ideogram fetch inside a Promise.all; too coupled to drive.
// (b) /api/landing/generate (route.ts:270) inserts the auto-background image
//     {user_id, prompt:'[landing-bg] …', image_url, provider:'ideogram',
//      style:'REALISTIC', aspect_ratio:'ASPECT_16_9'} — NO client_id. Behind the
//     full landing AI + Ideogram path.
//     ► Both confirm the same truth as the driven paths: no create path writes a
//       client link, because the column does not exist.
// (c) edit/adapt provider fallbacks (Ideogram remix, DALL-E) and the Gemini→Ideogram
//     quota fallback are network branches; only the Gemini happy path is exercised.
// (d) Readers (GET /api/images, dashboard count at app/(dashboard)/page.tsx:64,
//     images dashboard page) all scope by user_id only — there is no per-client
//     read because there is no per-client column.
