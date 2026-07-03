// app/api/autonomy/require-owned-client.ts
//
// Shared auth + ownership guard for the autonomy routes (pattern from
// app/api/campaigns + app/api/voc): authenticate via the cookie-scoped client,
// then verify the caller owns the target client through the SAME RLS-scoped
// client — the row comes back only for its owner (defense-in-depth: the store
// also scopes every query by owner_user_id).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export interface OwnedClientContext {
  userId:   string;
  clientId: string;
}

/** Either the authenticated ownership context, or the error response to return. */
export type OwnershipCheck =
  | { ok: true;  ctx: OwnedClientContext }
  | { ok: false; response: NextResponse };

export async function requireOwnedClient(clientId: string): Promise<OwnershipCheck> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!clientId) {
    return { ok: false, response: NextResponse.json({ error: 'Missing clientId' }, { status: 400 }) };
  }

  const { data: owned, error } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .maybeSingle();
  if (error) {
    return { ok: false, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  }
  if (!owned) {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { ok: true, ctx: { userId: user.id, clientId } };
}
