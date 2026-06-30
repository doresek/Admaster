// ════════════════════════════════════════════
// Shared types for the organic publishing client (T4).
//
// This module publishes ORGANIC content (no paid budget) to a Facebook Page
// and an Instagram professional account via the Graph API. It is pure HTTP +
// types: no DB, no Supabase, no Next. The client defaults to DRY-RUN so the
// whole flow is exercisable — and green in CI — without any live credentials.
// ════════════════════════════════════════════

export interface MetaPublishClientOptions {
  // A Page access token (for Page endpoints) or a token with instagram_*
  // permissions (for IG endpoints). In dry-run it is never sent anywhere.
  accessToken: string;
  // Graph API version override (e.g. "v21.0"). Defaults to META_GRAPH_VERSION
  // from lib/meta-config so every callsite shares one source of truth.
  graphVersion?: string;
  // Default TRUE: record the would-be request and return a synthetic id with
  // NO network call. Set false to actually POST to Graph.
  dryRun?: boolean;
}

// A record of one publish request the client made (or would have made in
// dry-run). The access token is intentionally NEVER stored here.
export interface RecordedCall {
  method: 'POST';
  // Graph path relative to the version base, e.g. "/{pageId}/feed".
  path: string;
  // Full request URL including the graph base + version.
  endpoint: string;
  // The body params that were sent (or would be sent); token excluded.
  payload: Record<string, unknown>;
  // Whether this call was a dry-run (synthetic) or a live network POST.
  dryRun: boolean;
}

// ── Method params ────────────────────────────

export interface PublishPagePostParams {
  pageId: string;
  message: string;
  link?: string;
}

export interface PublishPagePhotoParams {
  pageId: string;
  message?: string;
  imageUrl: string;
}

export interface CreateMediaContainerParams {
  igUserId: string;
  imageUrl: string;
  caption?: string;
}

export interface PublishMediaParams {
  igUserId: string;
  creationId: string;
}

// ── Results ──────────────────────────────────
// Graph returns minimal JSON; we surface what each endpoint actually yields.

export interface PagePostResult {
  id: string; // "{pageId}_{postId}"
}

export interface PagePhotoResult {
  id: string; // photo id
  post_id?: string; // the resulting feed story id, when present
}

export interface MediaContainerResult {
  id: string; // the IG container "creation_id" used by the publish step
}

export interface PublishMediaResult {
  id: string; // the published IG media id
}

// The shape Graph uses for every error envelope.
export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

// A cleanly-parsed Graph API error. Thrown by live-mode requests so callers
// get a typed, inspectable failure instead of an opaque fetch result.
export class MetaGraphError extends Error {
  readonly type?: string;
  readonly code?: number;
  readonly errorSubcode?: number;
  readonly fbtraceId?: string;
  readonly status?: number;

  constructor(body: GraphErrorBody, status?: number) {
    super(body.message || 'Meta Graph API error');
    this.name = 'MetaGraphError';
    this.type = body.type;
    this.code = body.code;
    this.errorSubcode = body.error_subcode;
    this.fbtraceId = body.fbtrace_id;
    this.status = status;
  }
}
