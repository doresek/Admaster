// ════════════════════════════════════════════
// Ad creation — POST act_<id>/ads.
//
// Links an ad set to a creative. status defaults to PAUSED so a created ad
// never serves on its own — activation is a deliberate, separately-gated step.
// ════════════════════════════════════════════

import type { MetaAdsClient } from './client';
import type { CreateAdInput, CreateResult } from './types';

export async function createAd(
  this: MetaAdsClient,
  input: CreateAdInput,
): Promise<CreateResult> {
  const params: Record<string, unknown> = {
    name: input.name,
    adset_id: input.adsetId,
    creative: { creative_id: input.creativeId },
    status: input.status ?? 'PAUSED',
  };

  return this.post(this.accountEdge('ads'), params, 'ad');
}
