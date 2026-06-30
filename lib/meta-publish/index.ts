// ════════════════════════════════════════════
// lib/meta-publish — typed organic publishing client (T4).
//
// Public surface:
//   new MetaPublishClient({ accessToken, graphVersion?, dryRun = true })
//   publishPagePost(client, { pageId, message, link? })
//   publishPagePhoto(client, { pageId, message?, imageUrl })
//   createMediaContainer(client, { igUserId, imageUrl, caption? })
//   publishMedia(client, { igUserId, creationId })
//
// Defaults to DRY-RUN: synthetic ids + a `.calls` log, no network, no creds.
// ════════════════════════════════════════════

export { MetaPublishClient } from './client';
export { publishPagePost, publishPagePhoto } from './pages';
export { createMediaContainer, publishMedia } from './instagram';
export {
  MetaGraphError,
  type MetaPublishClientOptions,
  type RecordedCall,
  type GraphErrorBody,
  type PublishPagePostParams,
  type PublishPagePhotoParams,
  type CreateMediaContainerParams,
  type PublishMediaParams,
  type PagePostResult,
  type PagePhotoResult,
  type MediaContainerResult,
  type PublishMediaResult,
} from './types';
