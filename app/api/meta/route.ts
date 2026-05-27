import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getDecryptedMetaToken } from '@/lib/meta';

const GRAPH = 'https://graph.facebook.com/v19.0';

async function metaFetch(path: string, token: string, method = 'GET', body?: object) {
  const url = method === 'GET'
    ? `${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`
    : `${GRAPH}/${path}`;

  const res = await fetch(url, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : undefined,
    body: method !== 'GET' ? JSON.stringify({ access_token: token, ...body }) : undefined,
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

// GET /api/meta?clientId=xxx&path=me/accounts&params=...
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get('clientId');
    const path     = searchParams.get('path') || 'me';
    const fields   = searchParams.get('fields') || '';

    if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });

    const token = await getDecryptedMetaToken(supabase, clientId, user.id);
    if (!token) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const fullPath = fields ? `${path}?fields=${fields}` : path;
    const result = await metaFetch(fullPath, token);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/meta — publish post or create campaign
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { clientId, path, body } = await req.json();

    if (!clientId || !path) return NextResponse.json({ error: 'Missing clientId or path' }, { status: 400 });

    const token = await getDecryptedMetaToken(supabase, clientId, user.id);
    if (!token) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const result = await metaFetch(path, token, 'POST', body);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
