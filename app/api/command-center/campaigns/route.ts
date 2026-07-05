// GET /api/command-center/campaigns  (AUTHENTICATED owner)
//
// Returns the owner's campaigns, each enriched with its items + decisions, and
// every `grounded_in` id resolved to the insight content+confidence so the UI
// can show *the WHY* behind each decision. READ-ONLY.
//
// Empty-safe: migration 030 (campaigns/campaign_items/campaign_decisions/
// client_insights) is unapplied in prod, so a missing relation is treated as
// "no campaigns yet" → { campaigns: [] }, never a 500.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  isMissingRelation,
  resolveInsights,
  attachGrounded,
  type Campaign,
  type CampaignItem,
  type CampaignDecision,
} from '../shared';

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Client-context propagation: when the app-wide active client is passed
    // (?clientId=), scope the view to it; with no active client the Command
    // Center stays the owner-wide "see everything" board. Ownership is still
    // enforced by owner_user_id regardless.
    const clientId = new URL(req.url).searchParams.get('clientId');

    // 1) Campaigns owned by the caller (newest first), optionally client-scoped.
    let campaignsQuery = supabase
      .from('campaigns')
      .select('id, status, channel, daily_budget, funnel_stage, grounded_in, rationale, meta_campaign_id, dry_run, created_at')
      .eq('owner_user_id', user.id);
    if (clientId) campaignsQuery = campaignsQuery.eq('client_id', clientId);
    const campaignsRes = await campaignsQuery.order('created_at', { ascending: false });

    if (campaignsRes.error) {
      if (isMissingRelation(campaignsRes.error)) return NextResponse.json({ campaigns: [] });
      throw campaignsRes.error;
    }

    const rawCampaigns = (campaignsRes.data ?? []) as Array<Record<string, any>>;
    if (rawCampaigns.length === 0) return NextResponse.json({ campaigns: [] });

    const campaignIds = rawCampaigns.map((c) => c.id);

    // 2) Items + decisions for those campaigns (each empty-safe on its own).
    const [itemsRes, decisionsRes] = await Promise.all([
      supabase
        .from('campaign_items')
        .select('id, campaign_id, item_type, status, grounded_in, rationale, targeting_spec')
        .in('campaign_id', campaignIds),
      supabase
        .from('campaign_decisions')
        .select('id, campaign_id, decision_type, decision, grounded_in, rationale')
        .in('campaign_id', campaignIds),
    ]);

    const rawItems = itemsRes.error
      ? (isMissingRelation(itemsRes.error) ? [] : (() => { throw itemsRes.error; })())
      : ((itemsRes.data ?? []) as Array<Record<string, any>>);
    const rawDecisions = decisionsRes.error
      ? (isMissingRelation(decisionsRes.error) ? [] : (() => { throw decisionsRes.error; })())
      : ((decisionsRes.data ?? []) as Array<Record<string, any>>);

    // 3) Resolve every grounded_in id across campaigns + items + decisions in one pass.
    const allIds: string[] = [];
    for (const c of rawCampaigns) allIds.push(...(c.grounded_in ?? []));
    for (const i of rawItems) allIds.push(...(i.grounded_in ?? []));
    for (const d of rawDecisions) allIds.push(...(d.grounded_in ?? []));
    const insightMap = await resolveInsights(supabase, allIds);

    // 4) Stitch the tree together.
    const itemsByCampaign = new Map<string, CampaignItem[]>();
    for (const i of rawItems) {
      const list = itemsByCampaign.get(i.campaign_id) ?? [];
      list.push({
        id: i.id,
        item_type: i.item_type ?? null,
        status: i.status ?? null,
        rationale: i.rationale ?? null,
        targeting_spec: i.targeting_spec ?? null,
        grounded_in: i.grounded_in ?? [],
        grounded: attachGrounded(i.grounded_in, insightMap),
      });
      itemsByCampaign.set(i.campaign_id, list);
    }

    const decisionsByCampaign = new Map<string, CampaignDecision[]>();
    for (const d of rawDecisions) {
      const list = decisionsByCampaign.get(d.campaign_id) ?? [];
      list.push({
        id: d.id,
        decision_type: d.decision_type ?? null,
        decision: d.decision ?? null,
        rationale: d.rationale ?? null,
        grounded_in: d.grounded_in ?? [],
        grounded: attachGrounded(d.grounded_in, insightMap),
      });
      decisionsByCampaign.set(d.campaign_id, list);
    }

    const campaigns: Campaign[] = rawCampaigns.map((c) => ({
      id: c.id,
      status: c.status ?? null,
      channel: c.channel ?? null,
      daily_budget: c.daily_budget ?? null,
      funnel_stage: c.funnel_stage ?? null,
      rationale: c.rationale ?? null,
      meta_campaign_id: c.meta_campaign_id ?? null,
      dry_run: c.dry_run ?? true, // default to safe (dry-run) if column absent
      grounded_in: c.grounded_in ?? [],
      grounded: attachGrounded(c.grounded_in, insightMap),
      items: itemsByCampaign.get(c.id) ?? [],
      decisions: decisionsByCampaign.get(c.id) ?? [],
    }));

    return NextResponse.json({ campaigns });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
