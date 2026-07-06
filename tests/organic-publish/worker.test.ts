// tests/organic-publish/worker.test.ts
//
// P1-4 publishing worker — fully deterministic: in-memory SlotStore, the REAL
// autonomy policy behind a stub route (no DB, no audit table), and the real
// MetaPublishClient in dry-run (it needs no network by design). Covers the
// task's matrix: happy dry-run, draft_only propose, malformed block, message-
// less skip, claim idempotency, post_kind dispatch, future-dated 'scheduled',
// live gate refusal, and the loud post-publish update failure.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routeAction, type AutonomyMode, type RouteAndLogInput } from '@/lib/autonomy';
import { MetaPublishClient } from '@/lib/meta-publish';
import type { CampaignItem } from '@/lib/campaigns/types';
import {
  DRY_RUN_PAGE_ID,
  inMemorySlotStore,
  publishDueSlots,
  type OrganicSlot,
  type PublishDueSlotsDeps,
} from '@/lib/organic-publish';

// ── fixtures ──────────────────────────────────────────────────────────────────

const OWNER = 'user_1';
const CLIENT = 'client_1';
const NOW = new Date('2026-07-06T10:00:00.000Z');
const PAST = '2026-07-06T09:00:00.000Z';   // due (past)
const SOON = '2026-07-06T10:10:00.000Z';   // due (future, inside the 15-min window)

let seq = 0;
function makeSlot(over: Partial<OrganicSlot> = {}): OrganicSlot {
  seq += 1;
  return {
    id: `slot_${seq}`,
    client_id: CLIENT,
    owner_user_id: OWNER,
    campaign_id: 'campaign_1',
    campaign_item_id: `item_${seq}`,
    page_id: null,
    post_kind: 'text',
    message: 'פוסט מוכן לפרסום — טיפ מקצועי מהתחום',
    image_url: null,
    link_url: null,
    scheduled_at: PAST,
    published_at: null,
    meta_post_id: null,
    status: 'planned',
    grounded_in: ['atom_1'],
    rationale: 'מבוסס על כאב שחזר אצל לקוחות',
    ...over,
  };
}

/** The REAL policy as the route dep — full verdict fidelity, zero I/O. */
function routeVia(mode: AutonomyMode) {
  return async (input: RouteAndLogInput) => ({
    route: routeAction(input.action, {
      mode,
      caps: {},
      todayActionCount: 0,
      todaySpendIls: input.spendContext.todaySpendIls,
      monthSpendIls: input.spendContext.monthSpendIls,
    }),
    mode,
  });
}

/** Records updateItemStatus calls; shaped like the optional CampaignStore slice. */
function itemRecorder() {
  const calls: { id: string; status: string }[] = [];
  return {
    calls,
    store: {
      async updateItemStatus(id: string, status: CampaignItem['status']) {
        calls.push({ id, status });
        return null;
      },
    },
  };
}

function baseDeps(
  store: ReturnType<typeof inMemorySlotStore>,
  over: Partial<PublishDueSlotsDeps> = {},
): PublishDueSlotsDeps {
  return { slotStore: store, route: routeVia('propose_approve'), ...over };
}

beforeEach(() => {
  delete process.env.LIVE_PUBLISH_ENABLED;
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── the matrix ────────────────────────────────────────────────────────────────

describe('publishDueSlots — happy dry-run', () => {
  it('planned → publishing (claim) → published, with a dryrun meta_post_id + item update', async () => {
    const slot = makeSlot();
    const store = inMemorySlotStore([slot]);
    const items = itemRecorder();

    const res = await publishDueSlots(
      { ownerUserId: OWNER, now: NOW },
      baseDeps(store, { campaignStore: items.store }),
    );

    expect(res.dryRun).toBe(true);
    expect(res.live).toBe(false);
    expect(res.refused).toBe(false);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].outcome).toBe('published');
    expect(res.results[0].metaPostId).toMatch(/^dryrun_post_/);

    const row = store.slots[0];
    expect(row.status).toBe('published');
    expect(row.meta_post_id).toMatch(/^dryrun_post_/);
    expect(row.published_at).toBe(NOW.toISOString());
    expect(items.calls).toEqual([{ id: slot.campaign_item_id, status: 'published' }]);
  });

  it('publishes by slot_id even when scheduled_at is beyond the due window', async () => {
    const slot = makeSlot({ scheduled_at: '2026-07-08T10:00:00.000Z' });
    const store = inMemorySlotStore([slot]);

    const res = await publishDueSlots(
      { ownerUserId: OWNER, slotId: slot.id, now: NOW },
      baseDeps(store),
    );

    // Future-dated ⇒ intent recorded, not a publication.
    expect(res.results[0].outcome).toBe('scheduled');
    expect(store.slots[0].status).toBe('scheduled');
  });
});

describe('autonomy verdicts', () => {
  it('draft_only → propose: slot untouched, nothing published, item untouched', async () => {
    const slot = makeSlot();
    const store = inMemorySlotStore([slot]);
    const items = itemRecorder();

    const res = await publishDueSlots(
      { ownerUserId: OWNER, now: NOW },
      baseDeps(store, { route: routeVia('draft_only'), campaignStore: items.store }),
    );

    expect(res.results[0].outcome).toBe('proposed');
    expect(res.results[0].reason).toContain('draft_only');
    expect(store.slots[0].status).toBe('planned');
    expect(store.slots[0].meta_post_id).toBeNull();
    expect(items.calls).toEqual([]);
  });

  it('missing grounding/rationale → BLOCK (malformed), slot marked failed', async () => {
    const slot = makeSlot({
      rationale: null,
      grounded_in: null as unknown as string[],
    });
    const store = inMemorySlotStore([slot]);

    const res = await publishDueSlots({ ownerUserId: OWNER, now: NOW }, baseDeps(store));

    expect(res.results[0].outcome).toBe('blocked');
    expect(res.results[0].reason).toContain('malformed');
    expect(store.slots[0].status).toBe('failed');
    expect(store.slots[0].meta_post_id).toBeNull();
  });
});

describe('skips + claim idempotency', () => {
  it('skips message-less slots (P1-3 pending) and leaves them planned', async () => {
    const empty = makeSlot({ message: null });
    const blank = makeSlot({ message: '   ' });
    const store = inMemorySlotStore([empty, blank]);

    const res = await publishDueSlots({ ownerUserId: OWNER, now: NOW }, baseDeps(store));

    expect(res.results.map((r) => r.outcome)).toEqual(['skipped', 'skipped']);
    expect(res.results[0].reason).toContain('no message');
    expect(store.slots.every((s) => s.status === 'planned')).toBe(true);
  });

  it("a 'publishing' row (live claim) is never picked by the due scan", async () => {
    const claimed = makeSlot({ status: 'publishing' });
    const store = inMemorySlotStore([claimed]);

    const res = await publishDueSlots({ ownerUserId: OWNER, now: NOW }, baseDeps(store));

    expect(res.results).toHaveLength(0);
    expect(store.slots[0].status).toBe('publishing');
  });

  it("a 'publishing' row addressed by slot_id is skipped, not re-published", async () => {
    const claimed = makeSlot({ status: 'publishing' });
    const store = inMemorySlotStore([claimed]);

    const res = await publishDueSlots(
      { ownerUserId: OWNER, slotId: claimed.id, now: NOW },
      baseDeps(store),
    );

    expect(res.results[0].outcome).toBe('skipped');
    expect(res.results[0].reason).toContain('idempotency');
    expect(store.slots[0].meta_post_id).toBeNull();
  });

  it('a lost claim race → skipped, no publish call', async () => {
    const slot = makeSlot();
    const store = inMemorySlotStore([slot]);
    const racingStore = {
      ...store,
      // Another worker wins the claim between listDue and claimSlot.
      claimSlot: async () => false,
    };
    const client = new MetaPublishClient({ accessToken: 'dry-run', dryRun: true });

    const res = await publishDueSlots(
      { ownerUserId: OWNER, now: NOW },
      baseDeps(store, { slotStore: racingStore, makePublishClient: () => client }),
    );

    expect(res.results[0].outcome).toBe('skipped');
    expect(res.results[0].reason).toContain('claim lost');
    expect(client.calls).toHaveLength(0);
  });
});

describe('post_kind dispatch (real MetaPublishClient, dry-run)', () => {
  it('text → /feed with message only', async () => {
    const store = inMemorySlotStore([makeSlot({ post_kind: 'text' })]);
    const client = new MetaPublishClient({ accessToken: 'dry-run', dryRun: true });

    await publishDueSlots(
      { ownerUserId: OWNER, now: NOW },
      baseDeps(store, { makePublishClient: () => client }),
    );

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].path).toBe(`/${DRY_RUN_PAGE_ID}/feed`);
    expect(client.calls[0].payload).not.toHaveProperty('link');
    expect(client.calls[0].dryRun).toBe(true);
  });

  it('link → /feed with the link_url in the payload', async () => {
    const store = inMemorySlotStore([
      makeSlot({ post_kind: 'link', link_url: 'https://example.co.il/offer' }),
    ]);
    const client = new MetaPublishClient({ accessToken: 'dry-run', dryRun: true });

    await publishDueSlots(
      { ownerUserId: OWNER, now: NOW },
      baseDeps(store, { makePublishClient: () => client }),
    );

    expect(client.calls[0].path).toBe(`/${DRY_RUN_PAGE_ID}/feed`);
    expect(client.calls[0].payload.link).toBe('https://example.co.il/offer');
  });

  it('photo → /photos with url + caption; slot page_id wins over the fallback', async () => {
    const store = inMemorySlotStore([
      makeSlot({ post_kind: 'photo', page_id: 'page_77', image_url: 'https://cdn.example/pic.jpg' }),
    ]);
    const client = new MetaPublishClient({ accessToken: 'dry-run', dryRun: true });

    const res = await publishDueSlots(
      { ownerUserId: OWNER, now: NOW },
      baseDeps(store, { makePublishClient: () => client }),
    );

    expect(client.calls[0].path).toBe('/page_77/photos');
    expect(client.calls[0].payload.url).toBe('https://cdn.example/pic.jpg');
    expect(client.calls[0].payload.caption).toBeTruthy();
    expect(res.results[0].outcome).toBe('published');
  });

  it('photo without image_url → failed (publisher refuses), slot marked failed', async () => {
    const store = inMemorySlotStore([makeSlot({ post_kind: 'photo', image_url: null })]);

    const res = await publishDueSlots({ ownerUserId: OWNER, now: NOW }, baseDeps(store));

    expect(res.results[0].outcome).toBe('failed');
    expect(res.results[0].reason).toContain('imageUrl');
    expect(store.slots[0].status).toBe('failed');
  });
});

describe('future-dated slots (inside the due window)', () => {
  it("records the intent: status 'scheduled', dryrun meta_post_id, NO published_at", async () => {
    const slot = makeSlot({ scheduled_at: SOON });
    const store = inMemorySlotStore([slot]);
    const items = itemRecorder();

    const res = await publishDueSlots(
      { ownerUserId: OWNER, now: NOW },
      baseDeps(store, { campaignStore: items.store }),
    );

    expect(res.results[0].outcome).toBe('scheduled');
    expect(res.results[0].metaPostId).toMatch(/^dryrun_post_/);
    const row = store.slots[0];
    expect(row.status).toBe('scheduled');
    expect(row.meta_post_id).toMatch(/^dryrun_post_/);
    expect(row.published_at).toBeNull();
    expect(items.calls).toEqual([{ id: slot.campaign_item_id, status: 'scheduled' }]);
  });
});

describe('live gate — NEVER auto-live', () => {
  it('live:true without LIVE_PUBLISH_ENABLED → refused outright, no slot touched', async () => {
    const slot = makeSlot();
    const store = inMemorySlotStore([slot]);

    const res = await publishDueSlots(
      { ownerUserId: OWNER, now: NOW, live: true },
      baseDeps(store),
    );

    expect(res.refused).toBe(true);
    expect(res.live).toBe(false);
    expect(res.dryRun).toBe(true);
    expect(res.results).toHaveLength(0);
    expect(store.slots[0].status).toBe('planned');
  });

  it('live:true with the flag on but no token → slot failed with a clear reason', async () => {
    process.env.LIVE_PUBLISH_ENABLED = 'true';
    const slot = makeSlot();
    const store = inMemorySlotStore([slot]);
    const client = new MetaPublishClient({ accessToken: 'x', dryRun: true });

    const res = await publishDueSlots(
      { ownerUserId: OWNER, now: NOW, live: true },
      baseDeps(store, { getToken: async () => null, makePublishClient: () => client }),
    );

    expect(res.results[0].outcome).toBe('failed');
    expect(res.results[0].reason).toContain('no Meta token');
    expect(store.slots[0].status).toBe('failed');
    expect(client.calls).toHaveLength(0);
  });
});

describe('write-back failure after a publish', () => {
  it('logs LOUDLY, reports published, and never re-publishes (row stays claimed)', async () => {
    const slot = makeSlot();
    const store = inMemorySlotStore([slot]);
    const brokenStore = {
      ...store,
      updateSlot: async () => null, // the write-back outage
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await publishDueSlots(
      { ownerUserId: OWNER, now: NOW },
      baseDeps(store, { slotStore: brokenStore }),
    );

    expect(res.results[0].outcome).toBe('published');
    expect(res.results[0].metaPostId).toMatch(/^dryrun_post_/);
    expect(res.results[0].reason).toContain('do not re-publish');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('LOUD'));
    // The claim landed before the outage — the row is out of 'planned', so a
    // second run picks nothing and cannot double-post.
    expect(store.slots[0].status).toBe('publishing');
    const rerun = await publishDueSlots({ ownerUserId: OWNER, now: NOW }, baseDeps(store));
    expect(rerun.results).toHaveLength(0);
  });
});

describe('scoping + batch isolation', () => {
  it('client_id scopes the batch; a failing slot never stops the next one', async () => {
    const bad = makeSlot({ post_kind: 'photo', image_url: null, scheduled_at: PAST });
    const good = makeSlot({ scheduled_at: SOON });
    const other = makeSlot({ client_id: 'client_2' });
    const store = inMemorySlotStore([bad, good, other]);

    const res = await publishDueSlots(
      { ownerUserId: OWNER, clientId: CLIENT, now: NOW },
      baseDeps(store),
    );

    expect(res.results.map((r) => r.outcome)).toEqual(['failed', 'scheduled']);
    expect(store.slots.find((s) => s.client_id === 'client_2')!.status).toBe('planned');
  });
});
