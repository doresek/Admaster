// ════════════════════════════════════════════
// Instagram organic publishing — the mandatory TWO-STEP content-publish flow.
//
//  1. createMediaContainer → POST /{igUserId}/media          { image_url, caption }
//     returns a container id (the "creation_id").
//  2. publishMedia         → POST /{igUserId}/media_publish  { creation_id }
//     promotes the container to a live post and returns the media id.
//
// Callers MUST run step 1 before step 2 and feed the container id forward;
// these helpers keep the two steps explicit so that ordering is testable.
// ════════════════════════════════════════════

import type { MetaPublishClient } from './client';
import type {
  CreateMediaContainerParams,
  MediaContainerResult,
  PublishMediaParams,
  PublishMediaResult,
} from './types';

// Step 1: create an image media container. Returns the creation_id needed by
// publishMedia.
export async function createMediaContainer(
  client: MetaPublishClient,
  { igUserId, imageUrl, caption }: CreateMediaContainerParams,
): Promise<MediaContainerResult> {
  if (!igUserId) throw new Error('createMediaContainer requires an igUserId');
  if (!imageUrl) throw new Error('createMediaContainer requires an imageUrl');

  const payload: Record<string, unknown> = { image_url: imageUrl };
  if (caption) payload.caption = caption;

  const json = await client.request(`/${igUserId}/media`, payload);
  return { id: json.id };
}

// Step 2: publish a previously-created container to the IG account's feed.
export async function publishMedia(
  client: MetaPublishClient,
  { igUserId, creationId }: PublishMediaParams,
): Promise<PublishMediaResult> {
  if (!igUserId) throw new Error('publishMedia requires an igUserId');
  if (!creationId) throw new Error('publishMedia requires a creationId');

  const json = await client.request(`/${igUserId}/media_publish`, {
    creation_id: creationId,
  });
  return { id: json.id };
}
