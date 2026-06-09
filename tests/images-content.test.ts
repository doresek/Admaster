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
//   016_generated_images_client_id.sql  + client_id (nullable FK → meta_clients,
//                                          on delete set null) + index
//
//   ► As of migration 016, generated_images HAS a nullable client_id FK to
//     meta_clients (like landing_pages, and like generated_content from 004).
//     The create paths now persist the active client_id, so image→client
//     attribution works going forward; only rows created before this slice
//     (or with no active client) carry null.

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
  // A valid active-client cookie value (readActiveClientCookie requires a 36-char id).
  const ACTIVE = '22222222-2222-2222-2222-222222222222';

  it('inserts owner-scoped row that persists the active client_id; parent/edit null on a fresh gen', async () => {
    const { POST } = await import('@/app/api/images/route');
    const res = await POST(fakeReq(
      { smart: false, prompt: 'a cat in a hat', aspectRatio: 'ASPECT_1_1', style: 'REALISTIC' },
      { cookie: `admaster_active_client=${ACTIVE}` },
    ));

    expect(res.status).toBe(200);
    expect(H.captured.imageInsert).toEqual({
      user_id:         'owner-1',
      client_id:       ACTIVE,            // now linked to the active client
      prompt:          'a cat in a hat',
      image_url:       'https://stored/img.png',
      provider:        'gemini',          // default provider (GOOGLE_SERVICE_ACCOUNT_JSON set)
      style:           'REALISTIC',
      aspect_ratio:    'ASPECT_1_1',
      parent_image_id: null,
      edit_prompt:     null,
    });
  });

  it('client_id is null when no active client (and body omits it)', async () => {
    const { POST } = await import('@/app/api/images/route');
    await POST(fakeReq({ smart: false, prompt: 'x' })); // no cookie, no body client_id
    expect(H.captured.imageInsert.client_id).toBeNull();
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
  it('persists parent_image_id + edit_prompt + tagged prompt; and the active client_id', async () => {
    // generateGemini fetches the source image when editing — stub it.
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
      headers: { get: () => 'image/png' },
    }));

    const ACTIVE = '33333333-3333-3333-3333-333333333333';
    const { POST } = await import('@/app/api/images/route');
    const res = await POST(fakeReq({
      mode: 'edit', editPrompt: 'make it blue',
      parentImageId: 'img-1', parentImageUrl: 'https://src/old.png',
      provider: 'gemini', aspectRatio: 'ASPECT_1_1', style: 'REALISTIC',
    }, { cookie: `admaster_active_client=${ACTIVE}` }));

    expect(res.status).toBe(200);
    expect(H.captured.imageInsert.parent_image_id).toBe('img-1');
    expect(H.captured.imageInsert.edit_prompt).toBe('make it blue');
    expect(H.captured.imageInsert.prompt).toBe('[edit] make it blue'); // promptTag prefix
    expect(H.captured.imageInsert.client_id).toBe(ACTIVE);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Smart pipeline — the client is threaded AND now persisted
//    The route resolves a clientId, threads it into runImagePipeline, and the
//    persisted generated_images row now carries the same client_id.
// ════════════════════════════════════════════════════════════════════
describe('POST /api/images smart — pipeline insert shape (real handler)', () => {
  it('writes candidate_urls/judge_rationale/is_smart, and persists the resolved client_id', async () => {
    const { POST } = await import('@/app/api/images/route');
    const res = await POST(fakeReq({
      smart: true, adCopy: 'מבצע קיץ', aspectRatio: 'ASPECT_1_1', style: 'REALISTIC',
      client_id: 'client-9',
    }));

    expect(res.status).toBe(200);

    // The route resolves the client and passes it down the pipeline …
    expect(H.captured.pipelineInput.clientId).toBe('client-9');

    // … and the row it saved carries that same client reference.
    expect(H.captured.imageInsert).toEqual({
      user_id:         'owner-1',
      client_id:       'client-9',
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
// 6. ATTRIBUTION MODEL — "images per client" is now a direct lookup.
//    Migration 016 added generated_images.client_id, and the create paths now
//    persist the active client. A row's client is read straight off client_id
//    (no join needed). Rows predating the slice (or created with no active
//    client) carry null and fall into the unattributed bucket.
// ════════════════════════════════════════════════════════════════════
type ImageRow = {
  id: string; user_id: string;
  parent_image_id: string | null; used_in: string | null;
  client_id: string | null;   // added by migration 016
};

// Bucket images by their (now-present) client_id; null → unattributed.
function imagesPerClient(rows: ImageRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const clientId = r.client_id ?? null;
    const bucket = clientId ?? '__unattributed__';
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

describe('attribution model: generated_images.client_id drives per-client counts', () => {
  it('NOW: images created with an active client attribute to that client', () => {
    const rows: ImageRow[] = [
      { id: 'i1', user_id: 'u1', parent_image_id: null, used_in: null,      client_id: 'client-A' },
      { id: 'i2', user_id: 'u1', parent_image_id: 'i1', used_in: 'landing', client_id: 'client-A' },
      { id: 'i3', user_id: 'u1', parent_image_id: null, used_in: null,      client_id: 'client-B' },
    ];
    expect(imagesPerClient(rows)).toEqual({ 'client-A': 2, 'client-B': 1 });
  });

  it('LEGACY: rows with null client_id (pre-slice / no active client) fall into the unattributed bucket', () => {
    const rows: ImageRow[] = [
      { id: 'i1', user_id: 'u1', parent_image_id: null, used_in: null, client_id: 'client-A' },
      { id: 'i2', user_id: 'u1', parent_image_id: null, used_in: null, client_id: null },
    ];
    expect(imagesPerClient(rows)).toEqual({ 'client-A': 1, __unattributed__: 1 });
  });
});

// ════════════════════════════════════════════════════════════════════
// COUPLING FINDINGS — paths intentionally NOT driven here
// ════════════════════════════════════════════════════════════════════
// (a) /api/quick-campaign inserts generated_images now including
//     client_id: activeClientId ?? null — but it's reached only after an Anthropic
//     copy-gen call + an Ideogram fetch inside a Promise.all; too coupled to drive
//     here. (The same route's generated_content insert is covered in
//     tests/posts-content.test.ts; both reuse the one resolved activeClientId.)
// (b) /api/landing/generate inserts the auto-background image now including
//     client_id: activeClientId ?? null — behind the full landing AI + Ideogram path.
//     ► Both now persist the active client, matching the driven /api/images paths.
// (c) edit/adapt provider fallbacks (Ideogram remix, DALL-E) and the Gemini→Ideogram
//     quota fallback are network branches; only the Gemini happy path is exercised.
// (d) Readers (GET /api/images, dashboard count at app/(dashboard)/page.tsx:64,
//     images dashboard page) still scope by user_id only — unchanged in this slice,
//     even though a per-client read is now possible via the new client_id column.
