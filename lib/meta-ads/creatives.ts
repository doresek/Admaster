// ════════════════════════════════════════════
// Ad creative creation — POST act_<id>/adcreatives.
//
// Builds an object_story_spec link_data creative from a page id + message +
// link + image (hash or url) + optional call_to_action. Exactly one image
// source must be supplied (imageHash references the ad account image library;
// imageUrl is a public URL). Creatives carry no spend status themselves.
// ════════════════════════════════════════════

import type { MetaAdsClient } from './client';
import type { CreateAdCreativeInput, CreateResult } from './types';

// Build the object_story_spec.link_data payload. Pure / exported for testing.
export function buildObjectStorySpec(input: CreateAdCreativeInput): Record<string, unknown> {
  if (!input.imageHash && !input.imageUrl) {
    throw new Error('createAdCreative requires one of imageHash or imageUrl');
  }
  if (input.imageHash && input.imageUrl) {
    throw new Error('createAdCreative accepts only one of imageHash or imageUrl');
  }

  const linkData: Record<string, unknown> = {
    message: input.message,
    link: input.link,
  };
  if (input.imageHash) linkData.image_hash = input.imageHash;
  if (input.imageUrl) linkData.picture = input.imageUrl;
  if (input.description) linkData.description = input.description;
  if (input.caption) linkData.caption = input.caption;
  if (input.callToAction) linkData.call_to_action = input.callToAction;

  const spec: Record<string, unknown> = {
    page_id: input.pageId,
    link_data: linkData,
  };
  if (input.instagramActorId) spec.instagram_actor_id = input.instagramActorId;
  return spec;
}

export async function createAdCreative(
  this: MetaAdsClient,
  input: CreateAdCreativeInput,
): Promise<CreateResult> {
  const params: Record<string, unknown> = {
    object_story_spec: buildObjectStorySpec(input),
  };
  if (input.name) params.name = input.name;

  return this.post(this.accountEdge('adcreatives'), params, 'creative');
}
