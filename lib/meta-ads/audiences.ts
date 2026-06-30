// ════════════════════════════════════════════
// Audience creation — POST act_<id>/customaudiences.
//
// createCustomAudience builds a (rule-based or seed) custom audience.
// createLookalikeAudience builds a LOOKALIKE audience modelled from a source
// audience via the Graph `lookalike_spec` (country + ratio). Neither touches
// spend; they are inputs the decision engine references by id in targeting.
// ════════════════════════════════════════════

import type { MetaAdsClient } from './client';
import type {
  CreateCustomAudienceInput,
  CreateLookalikeAudienceInput,
  CreateResult,
} from './types';

export async function createCustomAudience(
  this: MetaAdsClient,
  input: CreateCustomAudienceInput,
): Promise<CreateResult> {
  const params: Record<string, unknown> = {
    name: input.name,
    subtype: input.subtype ?? 'CUSTOM',
  };
  if (input.description) params.description = input.description;
  if (input.rule) params.rule = input.rule;
  if (input.customerFileSource) params.customer_file_source = input.customerFileSource;

  return this.post(this.accountEdge('customaudiences'), params, 'audience');
}

// Build the Graph lookalike_spec. Pure / exported for testing.
export function buildLookalikeSpec(
  input: CreateLookalikeAudienceInput,
): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    country: input.country,
    ratio: input.ratio,
    type: 'similarity',
  };
  if (input.startingRatio !== undefined) spec.starting_ratio = input.startingRatio;
  return spec;
}

export async function createLookalikeAudience(
  this: MetaAdsClient,
  input: CreateLookalikeAudienceInput,
): Promise<CreateResult> {
  const params: Record<string, unknown> = {
    name: input.name,
    subtype: 'LOOKALIKE',
    origin_audience_id: input.originAudienceId,
    lookalike_spec: buildLookalikeSpec(input),
  };
  if (input.description) params.description = input.description;

  return this.post(this.accountEdge('customaudiences'), params, 'lookalike');
}
