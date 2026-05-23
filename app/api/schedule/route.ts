import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

const GRAPH = 'https://graph.facebook.com/v19.0';

// GET /api/schedule?clientId=xxx&month=2026-05
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  const month    = req.nextUrl.searchParams.get('month'); // YYYY-MM

  const query = supabase.from('scheduled_posts').select('*').eq('user_id', user.id);
  if (clientId) query.eq('client_id', clientId);
  if (month) {
    query.gte('scheduled_at', `${month}-01`)
         .lt('scheduled_at', `${month}-32`);
  }

  const { data } = await query.order('scheduled_at');
  return NextResponse.json(data ?? []);
}

// POST /api/schedule — create scheduled post
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { clientId, pageId, message, scheduledAt, imageUrl, platform } = await req.json();

  if (!clientId || !pageId || !message || !scheduledAt) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  // Get client
  const { data: client } = await supabase
    .from('meta_clients').select('token').eq('id', clientId).eq('user_id', user.id).single();
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const scheduledDate = new Date(scheduledAt);
  const now = new Date();
  let metaPostId = null;

  // If scheduled in the future, use Meta scheduling
  if (scheduledDate > now) {
    try {
      const publishTime = Math.floor(scheduledDate.getTime() / 1000);
      const body: any = {
        message,
        published: false,
        scheduled_publish_time: publishTime,
        access_token: client.token,
      };
      if (imageUrl) body.link = imageUrl;

      const res = await fetch(`${GRAPH}/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.error) metaPostId = data.id;
    } catch (_) {}
  }

  const { data: post } = await supabase.from('scheduled_posts').insert({
    user_id: user.id, client_id: clientId, page_id: pageId,
    message, image_url: imageUrl, scheduled_at: scheduledAt,
    meta_post_id: metaPostId, status: 'scheduled', platform: platform || 'facebook',
  }).select().single();

  return NextResponse.json(post);
}

// DELETE /api/schedule?id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await supabase.from('scheduled_posts').delete().eq('id', id).eq('user_id', user.id);
  return NextResponse.json({ success: true });
}
