import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/support — list tickets (with first message preview)
// GET /api/support?id=... — fetch ticket + messages
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');

  if (id) {
    const [ticket, messages] = await Promise.all([
      supabase.from('support_tickets').select('*').eq('id', id).eq('user_id', user.id).maybeSingle(),
      supabase.from('support_messages').select('*').eq('ticket_id', id).order('created_at', { ascending: true }),
    ]);
    if (ticket.error || !ticket.data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ticket: ticket.data, messages: messages.data ?? [] });
  }

  const { data } = await supabase
    .from('support_tickets')
    .select('id, subject, category, status, priority, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  return NextResponse.json(data ?? []);
}

// POST /api/support — create ticket (or add message to existing one)
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ticketId, subject, category, body, priority } = await req.json();

  if (ticketId) {
    if (!body?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 });
    // Verify ownership
    const { data: t } = await supabase.from('support_tickets').select('id').eq('id', ticketId).eq('user_id', user.id).maybeSingle();
    if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data: msg, error } = await supabase.from('support_messages').insert({
      ticket_id: ticketId, author_id: user.id, body, is_staff: false,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Bump updated_at and reopen if previously closed
    await supabase.from('support_tickets')
      .update({ updated_at: new Date().toISOString(), status: 'open' })
      .eq('id', ticketId);
    return NextResponse.json(msg);
  }

  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Missing subject or body' }, { status: 400 });
  }

  const { data: ticket, error } = await supabase.from('support_tickets').insert({
    user_id:  user.id,
    subject,
    category: category ?? 'general',
    priority: priority ?? 'normal',
    status:   'open',
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('support_messages').insert({
    ticket_id: ticket.id, author_id: user.id, body, is_staff: false,
  });

  return NextResponse.json(ticket);
}

// PATCH /api/support?id=... — close ticket
export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { status } = await req.json();
  if (!['open','closed','resolved'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const { data } = await supabase.from('support_tickets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', user.id)
    .select().single();
  return NextResponse.json(data);
}
