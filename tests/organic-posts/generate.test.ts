// tests/organic-posts/generate.test.ts
//
// P1-3 organic post generator — deterministic unit tests. The LLM seam is the
// same stage-detecting stub pattern as tests/master-studio/pipeline.test.ts
// (valid [POST]/[IMAGE_PROMPT]… tag blocks); persistence is the in-memory
// CampaignStore + in-memory SlotWriter. No network, no DB, no Date.now().

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanSlot } from '@/lib/organic-calendar/types';
import { inMemoryCampaignStore } from '@/lib/campaigns/store';
import { deriveFunnelStage } from '@/lib/master-studio';
import {
  composeSlotBrief,
  generateForPlan,
  generateOrganicPost,
  inMemorySlotWriter,
  slotToStudioInput,
} from '@/lib/organic-posts';

// ── stage-detecting stub runner (pattern: tests/master-studio/pipeline.test.ts) ──

const STRAT = `[AVATAR_PROFILE]\npersona: בעלת עסק\nfears: x\ndesires: y\nawareness_level: 2\nobjections: z\n[/AVATAR_PROFILE]
[RANKED_MARKETERS]\n1. halbert|Gary|🔥|a\n2. cialdini|Rob|🧲|b\n3. hormozi|Alex|💰|c\n[/RANKED_MARKETERS]`;
const POST = (t: string) =>
  `[POST]${t}[/POST][HASHTAGS]#עסק[/HASHTAGS][IMAGE_PROMPT]bold scroll-stop image[/IMAGE_PROMPT][TIPS]t[/TIPS][WHATSAPP]w[/WHATSAPP]`;
const JUDGE = JSON.stringify({
  variants: [0, 1, 2].map((i) => ({
    index: i,
    score: i === 0 ? 90 : 50,
    dims: {
      scroll_stop: 50, hook_strength: 50, clarity: 50, emotional_resonance: 50,
      cta_strength: 50, brand_fit: 50, awareness_match: 50, framework_adherence: 50,
    },
    note: '',
  })),
  winner_index: 0,
  rationale: 'כי כן',
});

/**
 * Build a StageRunner: stage detected from the system prompt (אסטרטג/שופט/עורך,
 * else creator). `failCreatorWhenUserIncludes` makes the CREATOR stage return
 * garbage for briefs containing the marker — the per-slot failure switch.
 */
function stubRunner(opts: { creatorPost?: string; failCreatorWhenUserIncludes?: string; failAllCreators?: boolean } = {}) {
  return async (system: string, user: string, _maxTokens: number): Promise<string> => {
    if (system.includes('אסטרטג')) return STRAT;
    if (system.includes('שופט')) return JUDGE;
    if (system.includes('עורך')) return POST('edited');
    if (opts.failAllCreators) return 'no tags at all';
    if (opts.failCreatorWhenUserIncludes && user.includes(opts.failCreatorWhenUserIncludes)) {
      return 'no tags at all';
    }
    return POST(opts.creatorPost ?? 'פוסט מנצח לפייסבוק');
  };
}

// ── fixtures ───────────────────────────────────────────────────────────────────

const slot = (over: Partial<PlanSlot> = {}): PlanSlot => ({
  date: '2026-07-12',
  post_type: 'tip',
  topic: 'לקוחות מתלבטים לפני רכישה',
  angle: 'פתרון הכאב',
  grounded_in: ['atom-1', 'atom-2'],
  rationale: 'נגזר מאטום כאב פעיל',
  ...over,
});

const IDS = { clientId: 'client-1', ownerUserId: 'user-1', campaignId: 'campaign-1' };

/** Minimal admin stub for recordArtifactSafe's insert().select().single() chain. */
function fakeAdmin(rows: Record<string, unknown>[]): SupabaseClient {
  return {
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            const rec = { id: `art_${rows.length + 1}`, ...row };
            rows.push(rec);
            return { data: rec, error: null };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('generateOrganicPost', () => {
  it('happy path: writes the item and attaches the slot with the right grounding', async () => {
    const store = inMemoryCampaignStore();
    const writer = inMemorySlotWriter();
    const res = await generateOrganicPost({
      slot: slot(), slotId: 'slot-1', ...IDS,
      run: stubRunner(), store, slotWriter: writer,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.post.length).toBeGreaterThan(0);
    expect(res.imagePrompt.length).toBeGreaterThan(0);

    // campaign_items row — exactly one, the contracted shape.
    expect(store.items).toHaveLength(1);
    const item = store.items[0];
    expect(item.item_type).toBe('post');
    expect(item.status).toBe('assembled');
    expect(item.campaign_id).toBe('campaign-1');
    expect(item.client_id).toBe('client-1');
    expect(item.owner_user_id).toBe('user-1');
    expect(item.meta_object_id).toBeNull();
    expect(item.targeting_spec).toEqual({});
    expect(item.grounded_in).toEqual(['atom-1', 'atom-2']);
    expect(item.rationale).toBe('נגזר מאטום כאב פעיל');
    expect(item.artifact_id).toBeNull(); // no admin ⇒ artifact skipped, still ok
    expect(res.itemId).toBe(item.id);
    expect(res.artifactId).toBeNull();

    // schedule attachment — item id + final message + image prompt.
    expect(res.attached).toBe(true);
    expect(writer.attached).toHaveLength(1);
    expect(writer.attached[0].slotId).toBe('slot-1');
    expect(writer.attached[0].campaign_item_id).toBe(item.id);
    expect(writer.attached[0].message).toBe(res.post);
    expect(writer.attached[0].image_prompt).toBe(res.imagePrompt);
  });

  it('records the artifact when an admin is provided and links it on the item', async () => {
    const store = inMemoryCampaignStore();
    const writer = inMemorySlotWriter();
    const artifactRows: Record<string, unknown>[] = [];
    const res = await generateOrganicPost({
      slot: slot(), slotId: 'slot-1', ...IDS,
      run: stubRunner(), store, slotWriter: writer, admin: fakeAdmin(artifactRows),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.artifactId).not.toBeNull();
    expect(artifactRows).toHaveLength(1);
    const art = artifactRows[0] as Record<string, unknown>;
    expect(art.type).toBe('post');
    expect(art.insight_ids).toEqual(['atom-1', 'atom-2']);
    const gf = art.generated_from as Record<string, unknown>;
    expect(gf.source).toBe('organic-posts');
    expect(gf.post_type).toBe('tip');
    expect(gf.lint).toBeDefined(); // C-07 verdict travels with the artifact
    expect(store.items[0].artifact_id).toBe(res.artifactId);
  });

  it('pipeline failure ⇒ ok:false and ZERO writes (no item, no attach)', async () => {
    const store = inMemoryCampaignStore();
    const writer = inMemorySlotWriter();
    const res = await generateOrganicPost({
      slot: slot(), slotId: 'slot-1', ...IDS,
      run: stubRunner({ failAllCreators: true }), store, slotWriter: writer,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('creators');
    expect(store.items).toHaveLength(0);
    expect(writer.attached).toHaveLength(0);
  });

  it('lint verdict is present and NEVER blocks (flag-only doctrine)', async () => {
    const store = inMemoryCampaignStore();
    const writer = inMemorySlotWriter();
    const res = await generateOrganicPost({
      slot: slot(), slotId: 'slot-1', ...IDS,
      run: stubRunner(), store, slotWriter: writer, brandAtoms: [],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // No brand_voice atom ⇒ the lint flags it — but generation/recording proceed.
    expect(res.lint.violations.some((v) => v.rule === 'no_brand_voice')).toBe(true);
    expect(res.lint.checked.deterministic).toBe(true);
    expect(typeof res.lint.score).toBe('number');
    expect(store.items).toHaveLength(1);
    expect(writer.attached).toHaveLength(1);
  });

  it('no slotId ⇒ item written, attach skipped (attached:false)', async () => {
    const store = inMemoryCampaignStore();
    const writer = inMemorySlotWriter();
    const res = await generateOrganicPost({
      slot: slot(), ...IDS, run: stubRunner(), store, slotWriter: writer,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.attached).toBe(false);
    expect(store.items).toHaveLength(1);
    expect(writer.attached).toHaveLength(0);
  });
});

describe('generateForPlan', () => {
  it('runs sequentially over slots and CONTINUES past an individual failure', async () => {
    const store = inMemoryCampaignStore();
    const writer = inMemorySlotWriter();
    const slots = [
      { slot: slot({ topic: 'נושא ראשון' }), slotId: 'slot-1' },
      { slot: slot({ topic: 'FAILME נושא שני' }), slotId: 'slot-2' },
      { slot: slot({ topic: 'נושא שלישי', post_type: 'engagement' as const }), slotId: 'slot-3' },
    ];
    const out = await generateForPlan({
      slots, ...IDS,
      run: stubRunner({ failCreatorWhenUserIncludes: 'FAILME' }),
      store, slotWriter: writer,
    });

    expect(out.results).toHaveLength(3);
    expect(out.generated).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.results[0].result.ok).toBe(true);
    expect(out.results[1].result.ok).toBe(false);
    expect(out.results[2].result.ok).toBe(true);
    // The failing middle slot wrote nothing; slots 1+3 wrote and attached.
    expect(store.items).toHaveLength(2);
    expect(writer.attached.map((a) => a.slotId)).toEqual(['slot-1', 'slot-3']);
  });
});

describe('composeSlotBrief — brief template per post_type', () => {
  it('every post_type carries its Hebrew label + topic + angle + rationale', () => {
    const labels: Record<PlanSlot['post_type'], string> = {
      tip: 'טיפ מקצועי',
      story: 'סיפור',
      offer: 'הצעה/מבצע',
      engagement: 'פוסט מעורבות',
      holiday: 'פוסט חג',
    };
    for (const [type, label] of Object.entries(labels) as [PlanSlot['post_type'], string][]) {
      const s = slot({ post_type: type });
      const brief = composeSlotBrief(s);
      expect(brief).toContain(`סוג פוסט: ${label}`);
      expect(brief).toContain(`נושא: ${s.topic}`);
      expect(brief).toContain(`זווית: ${s.angle}`);
      expect(brief).toContain(s.rationale);
    }
  });

  it('holiday slot: the holiday name (carried in the topic) reaches the brief', () => {
    const s = slot({ post_type: 'holiday', topic: 'ברכת ראש השנה ללקוחות', angle: 'חיבור לחג' });
    const brief = composeSlotBrief(s);
    expect(brief).toContain('ראש השנה');
    expect(brief).toContain('פוסט חג');
  });

  it('slotToStudioInput: Facebook + Hebrew, and offer maps to BOFU via the type label', () => {
    const offer = slotToStudioInput(slot({ post_type: 'offer' }));
    expect(offer.platform).toBe('Facebook');
    expect(offer.locale).toBe('he');
    expect(deriveFunnelStage(offer.type)).toBe('BOFU');
    expect(deriveFunnelStage(slotToStudioInput(slot({ post_type: 'tip' })).type)).toBe('TOFU');
  });
});
