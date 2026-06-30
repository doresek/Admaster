// ════════════════════════════════════════════
// lib/meta-ads — public entrypoint.
//
// Assembles the create* methods (defined in sibling modules so each stays
// focused) onto MetaAdsClient via prototype assignment + declaration merging,
// then re-exports the client, its error type, and the full type surface.
//
// Usage:
//   import { MetaAdsClient } from '@/lib/meta-ads';
//   const ads = new MetaAdsClient({ accessToken, adAccountId }); // dryRun: true
//   const c   = await ads.createCampaign({ name, objective: 'OUTCOME_LEADS' });
//   // c.id === 'dryrun_campaign_1', ads.calls[0] holds the would-be payload.
// ════════════════════════════════════════════

import { MetaAdsClient } from './client';
import { createCampaign } from './campaigns';
import { createAdSet } from './adsets';
import { createAdCreative } from './creatives';
import { createAd } from './ads';
import { createCustomAudience, createLookalikeAudience } from './audiences';

import type {
  CreateAdInput,
  CreateAdCreativeInput,
  CreateAdSetInput,
  CreateCampaignInput,
  CreateCustomAudienceInput,
  CreateLookalikeAudienceInput,
  CreateResult,
} from './types';

// Declaration merging: tell TypeScript the prototype-attached methods exist on
// the class, with their proper signatures.
declare module './client' {
  interface MetaAdsClient {
    createCampaign(input: CreateCampaignInput): Promise<CreateResult>;
    createAdSet(input: CreateAdSetInput): Promise<CreateResult>;
    createAdCreative(input: CreateAdCreativeInput): Promise<CreateResult>;
    createAd(input: CreateAdInput): Promise<CreateResult>;
    createCustomAudience(input: CreateCustomAudienceInput): Promise<CreateResult>;
    createLookalikeAudience(input: CreateLookalikeAudienceInput): Promise<CreateResult>;
  }
}

Object.assign(MetaAdsClient.prototype, {
  createCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  createCustomAudience,
  createLookalikeAudience,
});

export { MetaAdsClient, MetaAdsApiError, parseGraphError, encodeParams } from './client';
export { buildTargeting } from './adsets';
export { buildObjectStorySpec } from './creatives';
export { buildLookalikeSpec } from './audiences';
export * from './types';
