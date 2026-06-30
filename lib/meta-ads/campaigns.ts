// ════════════════════════════════════════════
// Campaign creation — POST act_<id>/campaigns.
//
// Builds the Graph campaign payload. status defaults to PAUSED so a created
// campaign never starts spending on its own. Budgets, when supplied, are in
// MINOR currency units (cents/agorot) per Graph convention.
// ════════════════════════════════════════════

import type { MetaAdsClient } from './client';
import type { CreateCampaignInput, CreateResult } from './types';

export async function createCampaign(
  this: MetaAdsClient,
  input: CreateCampaignInput,
): Promise<CreateResult> {
  const params: Record<string, unknown> = {
    name: input.name,
    objective: input.objective,
    status: input.status ?? 'PAUSED',
    // Graph requires special_ad_categories on every campaign create; default
    // to the empty set when the caller does not declare a regulated category.
    special_ad_categories: input.specialAdCategories ?? [],
  };

  if (input.dailyBudget !== undefined) params.daily_budget = input.dailyBudget;
  if (input.lifetimeBudget !== undefined) params.lifetime_budget = input.lifetimeBudget;
  if (input.bidStrategy !== undefined) params.bid_strategy = input.bidStrategy;

  return this.post(this.accountEdge('campaigns'), params, 'campaign');
}
