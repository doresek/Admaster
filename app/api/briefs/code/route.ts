import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { issueBriefCode, BriefCodeError } from './issue';

// POST /api/briefs/code
// Single source of truth for brief-code issuance (replaces the duplicated
// inline inserts in the briefs page and send-brief page).
// Body (required): { client_id: string } — must belong to the authed user.
// Returns: { code, client_id }
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body → client_id missing → 400 */ }
  const clientId = typeof body?.client_id === 'string' ? body.client_id : null;

  try {
    const result = await issueBriefCode(supabase, user.id, clientId);
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err instanceof BriefCodeError ? err.status : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
