// Test helper: a REAL supabase-js client wired to an in-memory fetch double.
// This exercises the actual PostgREST query building (filters, on_conflict,
// rpc payloads) instead of hand-stubbing the client — and needs zero casts.
// Not a test file itself (no .test suffix → not collected by vitest).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * supabase-js eagerly constructs a RealtimeClient, which on Node 20 (no native
 * WebSocket) throws unless a transport is provided. Tests never open realtime
 * channels, so a structurally-complete no-op transport keeps createClient pure.
 */
class NoopWebSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly readyState: number = 3;
  readonly url: string;
  readonly protocol = '';
  onopen: ((this: unknown, ev: Event) => unknown) | null = null;
  onmessage: ((this: unknown, ev: MessageEvent) => unknown) | null = null;
  onclose: ((this: unknown, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: unknown, ev: Event) => unknown) | null = null;

  constructor(address: string | URL) {
    this.url = String(address);
  }
  close(): void {}
  send(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

export interface CapturedRequest {
  method:  string;
  /** URL pathname, e.g. '/rest/v1/episode_embeddings'. */
  path:    string;
  query:   URLSearchParams;
  headers: Record<string, string>;
  /** Parsed JSON body (null for GET). */
  body:    unknown;
}

export interface RouteResult {
  status?: number;
  json:    unknown;
}

/** Return a result for a request, or undefined to fail the test loudly. */
export type Route = (req: CapturedRequest) => RouteResult | undefined;

export function fakePostgrest(route: Route): {
  supabase: SupabaseClient;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    const rawBody = init?.body;
    const body: unknown = typeof rawBody === 'string' && rawBody ? JSON.parse(rawBody) : null;

    const request: CapturedRequest = {
      method: init?.method ?? 'GET',
      path:   url.pathname,
      query:  url.searchParams,
      headers,
      body,
    };
    requests.push(request);

    const result = route(request);
    if (!result) {
      return new Response(
        JSON.stringify({ message: `postgrest-fake: no route for ${request.method} ${request.path}` }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(result.json), {
      status:  result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const supabase = createClient('http://episodic-test.localhost', 'test-anon-key', {
    global:   { fetch: fetchImpl },
    auth:     { persistSession: false, autoRefreshToken: false },
    realtime: { transport: NoopWebSocket },
  });

  return { supabase, requests };
}
