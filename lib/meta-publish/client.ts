// ════════════════════════════════════════════
// MetaPublishClient — the low-level transport shared by pages.ts + instagram.ts.
//
// Responsibilities:
//  • Build the versioned Graph base (override per-instance, default from config).
//  • Keep a `.calls` log of every request (dry-run or live) for assertions and
//    auditing — the access token is NEVER recorded.
//  • DRY-RUN (default): record the would-be request and return a synthetic
//    `{ id: "dryrun_post_<n>" }` with NO network call.
//  • LIVE: POST form-encoded params to Graph with the token in the
//    Authorization header (kept out of URLs/logs), and parse Graph's error
//    envelope into a typed MetaGraphError.
// ════════════════════════════════════════════

import { META_GRAPH_VERSION } from '../meta-config';
import {
  MetaGraphError,
  type GraphErrorBody,
  type MetaPublishClientOptions,
  type RecordedCall,
} from './types';

export class MetaPublishClient {
  readonly accessToken: string;
  readonly graphVersion: string;
  readonly dryRun: boolean;
  // Append-only log of every request made through this client.
  readonly calls: RecordedCall[] = [];

  // Monotonic counter backing the synthetic dry-run ids.
  private callCounter = 0;

  constructor(options: MetaPublishClientOptions) {
    if (!options || !options.accessToken) {
      throw new Error('MetaPublishClient requires an accessToken');
    }
    this.accessToken = options.accessToken;
    this.graphVersion = (options.graphVersion || META_GRAPH_VERSION).trim();
    // Default TRUE — safe by construction.
    this.dryRun = options.dryRun ?? true;
  }

  // The versioned Graph base, e.g. https://graph.facebook.com/v21.0
  get graphBase(): string {
    return `https://graph.facebook.com/${this.graphVersion}`;
  }

  // POST `payload` to `path` (a leading-slash Graph path). Records the call,
  // then either returns a synthetic dry-run object or performs the live POST.
  // Returns the parsed Graph JSON (which always carries at least `id` for the
  // endpoints used here).
  async request(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, any>> {
    const endpoint = `${this.graphBase}${path}`;

    this.callCounter += 1;
    const call: RecordedCall = {
      method: 'POST',
      path,
      endpoint,
      payload: { ...payload },
      dryRun: this.dryRun,
    };
    this.calls.push(call);

    if (this.dryRun) {
      // Synthetic, deterministic id; no network.
      return { id: `dryrun_post_${this.callCounter}` };
    }

    return this.live(endpoint, payload);
  }

  // Perform the real network POST. Token goes in the Authorization header so it
  // never lands in a URL, query string, proxy log, or the `.calls` payload.
  private async live(
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, any>> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) body.set(key, String(value));
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // Non-JSON body (rare). Surface as a typed error with the HTTP status.
      throw new MetaGraphError(
        { message: `Meta Graph returned a non-JSON response (HTTP ${res.status})` },
        res.status,
      );
    }

    if (json && json.error) {
      throw new MetaGraphError(json.error as GraphErrorBody, res.status);
    }
    if (!res.ok) {
      throw new MetaGraphError({ message: `Meta Graph request failed (HTTP ${res.status})` }, res.status);
    }

    return json as Record<string, any>;
  }
}
