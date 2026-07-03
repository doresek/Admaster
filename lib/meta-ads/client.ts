// ════════════════════════════════════════════
// MetaAdsClient — typed Meta Marketing (Ads) API client.
//
// Defaults to DRY-RUN: every create* method returns a synthetic id and records
// the exact would-be Graph payload + endpoint on `.calls`, making NO network
// request. Live spending is gated elsewhere — pass { dryRun: false } and a real
// token to actually POST. All HTTP is isolated to one private method so tests
// run entirely dry, with no credentials.
//
// The create* methods live in sibling modules (campaigns/adsets/ads/creatives/
// audiences); index.ts assembles them onto the class. This file owns the
// transport: id normalisation, payload encoding, the dry/live branch, the call
// log, and Graph error parsing.
// ════════════════════════════════════════════

import { META_GRAPH_VERSION } from '../meta-config';
import type {
  CreateResult,
  GraphErrorBody,
  MetaAdsClientConfig,
  RecordedCall,
} from './types';

// Error thrown for any Graph API failure in live mode, with the parsed
// envelope attached so callers can inspect code / subcode / user message.
export class MetaAdsApiError extends Error {
  readonly graphError: GraphErrorBody;
  readonly httpStatus: number;

  constructor(message: string, graphError: GraphErrorBody, httpStatus: number) {
    super(message);
    this.name = 'MetaAdsApiError';
    this.graphError = graphError;
    this.httpStatus = httpStatus;
  }
}

// Coerce an arbitrary JSON body into a clean GraphErrorBody. Tolerates the
// `{ error: {...} }` envelope, a bare error object, or a non-object body.
export function parseGraphError(body: unknown): GraphErrorBody {
  const root =
    body && typeof body === 'object' && 'error' in (body as Record<string, unknown>)
      ? (body as Record<string, unknown>).error
      : body;
  if (!root || typeof root !== 'object') {
    return { message: 'Unknown Graph API error', code: -1 };
  }
  const e = root as Record<string, unknown>;
  return {
    message: typeof e.message === 'string' ? e.message : 'Unknown Graph API error',
    type: typeof e.type === 'string' ? e.type : undefined,
    code: typeof e.code === 'number' ? e.code : undefined,
    error_subcode: typeof e.error_subcode === 'number' ? e.error_subcode : undefined,
    error_user_title: typeof e.error_user_title === 'string' ? e.error_user_title : undefined,
    error_user_msg: typeof e.error_user_msg === 'string' ? e.error_user_msg : undefined,
    fbtrace_id: typeof e.fbtrace_id === 'string' ? e.fbtrace_id : undefined,
  };
}

// Encode a params object the way Graph expects on a form POST: scalars as
// strings, objects/arrays as JSON. access_token is handled separately and is
// never written into the recorded log.
export function encodeParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

export class MetaAdsClient {
  readonly accessToken: string;
  readonly adAccountId: string; // always normalised to "act_<id>"
  readonly graphVersion: string;
  readonly dryRun: boolean;
  readonly graphBase: string;

  // Append-only log of every would-be (dry) or actual (live) request.
  readonly calls: RecordedCall[] = [];

  // Per-kind monotonic counters backing the synthetic dry-run ids, so each
  // object type numbers independently (dryrun_campaign_1, dryrun_adset_1, ...).
  private dryRunSeq = new Map<string, number>();

  constructor(config: MetaAdsClientConfig) {
    this.accessToken = config.accessToken;
    this.adAccountId = MetaAdsClient.normalizeAdAccountId(config.adAccountId);
    this.graphVersion = (config.graphVersion || META_GRAPH_VERSION).trim();
    this.dryRun = config.dryRun ?? true;
    this.graphBase = `https://graph.facebook.com/${this.graphVersion}`;
  }

  // Graph ad account ids are addressed as "act_<numeric id>". Accept either form.
  static normalizeAdAccountId(id: string): string {
    const trimmed = (id || '').trim();
    if (!trimmed) return trimmed;
    return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
  }

  // Build a full endpoint URL under this account's node, e.g. ".../act_1/campaigns".
  accountEdge(edge: string): string {
    return `${this.graphBase}/${this.adAccountId}/${edge}`;
  }

  // Build a full endpoint URL for an arbitrary node edge, e.g. ".../<id>/edge".
  nodeEdge(node: string, edge: string): string {
    return `${this.graphBase}/${node}/${edge}`;
  }

  // The single create primitive used by every create* method.
  //  • dry-run: records the encoded payload + endpoint, returns a synthetic id.
  //  • live:    POSTs form-encoded params (+ access_token) and returns Graph's id.
  // `kind` only shapes the synthetic id (e.g. "campaign" → "dryrun_campaign_1").
  async post(
    endpoint: string,
    params: Record<string, unknown>,
    kind: string,
  ): Promise<CreateResult> {
    const encoded = encodeParams(params);

    this.calls.push({
      method: 'POST',
      endpoint,
      params: encoded,
      dryRun: this.dryRun,
    });

    if (this.dryRun) {
      const next = (this.dryRunSeq.get(kind) ?? 0) + 1;
      this.dryRunSeq.set(kind, next);
      return { id: `dryrun_${kind}_${next}`, dryRun: true };
    }

    return this.execute(endpoint, encoded, kind);
  }

  // The ONLY method that touches the network. Isolated so dry-run tests never
  // hit it. Bubbles Graph error envelopes as MetaAdsApiError.
  private async execute(
    endpoint: string,
    encoded: Record<string, string>,
    _kind: string,
  ): Promise<CreateResult> {
    const form = new URLSearchParams(encoded);
    form.set('access_token', this.accessToken);

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    } catch (networkErr) {
      const message =
        networkErr instanceof Error ? networkErr.message : 'network request failed';
      throw new MetaAdsApiError(message, { message, code: -1 }, 0);
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON body (rare). Leave as null; handled below.
    }

    if (!res.ok || (body && typeof body === 'object' && 'error' in (body as object))) {
      const graphError = parseGraphError(body);
      throw new MetaAdsApiError(
        graphError.error_user_msg || graphError.message || 'Graph API request failed',
        graphError,
        res.status,
      );
    }

    const id =
      body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string'
        ? (body as { id: string }).id
        : '';
    return { id, dryRun: false };
  }
}
