// ════════════════════════════════════════════
// Facebook Page organic publishing.
//
//  • publishPagePost  → POST /{pageId}/feed     (text + optional link)
//  • publishPagePhoto → POST /{pageId}/photos   (remote image + caption)
//
// Both require a PAGE access token (not a user token). Thin wrappers over
// MetaPublishClient.request so dry-run / live / `.calls` behaviour is uniform.
// ════════════════════════════════════════════

import type { MetaPublishClient } from './client';
import type {
  PagePhotoResult,
  PagePostResult,
  PublishPagePhotoParams,
  PublishPagePostParams,
} from './types';

// Publish a text post (optionally with a link) to a Page's feed.
export async function publishPagePost(
  client: MetaPublishClient,
  { pageId, message, link }: PublishPagePostParams,
): Promise<PagePostResult> {
  if (!pageId) throw new Error('publishPagePost requires a pageId');
  if (!message) throw new Error('publishPagePost requires a message');

  const payload: Record<string, unknown> = { message };
  if (link) payload.link = link;

  const json = await client.request(`/${pageId}/feed`, payload);
  return { id: json.id };
}

// Publish a photo (from a public image URL) to a Page, with an optional caption.
export async function publishPagePhoto(
  client: MetaPublishClient,
  { pageId, message, imageUrl }: PublishPagePhotoParams,
): Promise<PagePhotoResult> {
  if (!pageId) throw new Error('publishPagePhoto requires a pageId');
  if (!imageUrl) throw new Error('publishPagePhoto requires an imageUrl');

  // Graph's /photos endpoint takes `url` for the remote image and `caption`
  // for its text.
  const payload: Record<string, unknown> = { url: imageUrl };
  if (message) payload.caption = message;

  const json = await client.request(`/${pageId}/photos`, payload);
  return { id: json.id, post_id: json.post_id };
}
