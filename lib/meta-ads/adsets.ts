// ════════════════════════════════════════════
// Ad set creation — POST act_<id>/adsets.
//
// Builds the Graph ad set payload: budget (minor units), targeting spec,
// optimization_goal, billing_event. status defaults to PAUSED. The targeting
// spec is normalised (top-level `interests` folded into flexible_spec, and
// lookalike_audiences merged into custom_audiences, which is how Graph treats
// them at targeting time).
// ════════════════════════════════════════════

import type { MetaAdsClient } from './client';
import type { CreateAdSetInput, CreateResult, TargetingSpec } from './types';

// Convert our TargetingSpec into the exact Graph `targeting` object. Pure.
export function buildTargeting(spec: TargetingSpec): Record<string, unknown> {
  const targeting: Record<string, unknown> = {};

  if (spec.geo_locations) targeting.geo_locations = spec.geo_locations;
  if (spec.age_min !== undefined) targeting.age_min = spec.age_min;
  if (spec.age_max !== undefined) targeting.age_max = spec.age_max;
  if (spec.genders && spec.genders.length) targeting.genders = spec.genders;
  if (spec.locales && spec.locales.length) targeting.locales = spec.locales;

  // flexible_spec: start from any provided groups, then fold a flat top-level
  // `interests` list into its own OR group so both input styles work.
  const flexible = [...(spec.flexible_spec ?? [])];
  if (spec.interests && spec.interests.length) {
    flexible.push({ interests: spec.interests });
  }
  if (flexible.length) targeting.flexible_spec = flexible;

  // custom_audiences and lookalikes are addressed identically ({ id }); merge.
  const customAudiences = [
    ...(spec.custom_audiences ?? []),
    ...(spec.lookalike_audiences ?? []),
  ];
  if (customAudiences.length) targeting.custom_audiences = customAudiences;
  if (spec.excluded_custom_audiences && spec.excluded_custom_audiences.length) {
    targeting.excluded_custom_audiences = spec.excluded_custom_audiences;
  }

  if (spec.publisher_platforms && spec.publisher_platforms.length) {
    targeting.publisher_platforms = spec.publisher_platforms;
  }
  if (spec.facebook_positions && spec.facebook_positions.length) {
    targeting.facebook_positions = spec.facebook_positions;
  }
  if (spec.instagram_positions && spec.instagram_positions.length) {
    targeting.instagram_positions = spec.instagram_positions;
  }

  return targeting;
}

export async function createAdSet(
  this: MetaAdsClient,
  input: CreateAdSetInput,
): Promise<CreateResult> {
  const params: Record<string, unknown> = {
    campaign_id: input.campaignId,
    name: input.name,
    optimization_goal: input.optimizationGoal,
    billing_event: input.billingEvent,
    status: input.status ?? 'PAUSED',
    targeting: buildTargeting(input.targeting),
  };

  if (input.dailyBudget !== undefined) params.daily_budget = input.dailyBudget;
  if (input.lifetimeBudget !== undefined) params.lifetime_budget = input.lifetimeBudget;
  if (input.bidStrategy !== undefined) params.bid_strategy = input.bidStrategy;
  if (input.bidAmount !== undefined) params.bid_amount = input.bidAmount;
  if (input.startTime !== undefined) params.start_time = input.startTime;
  if (input.endTime !== undefined) params.end_time = input.endTime;
  if (input.promotedObject !== undefined) params.promoted_object = input.promotedObject;

  return this.post(this.accountEdge('adsets'), params, 'adset');
}
