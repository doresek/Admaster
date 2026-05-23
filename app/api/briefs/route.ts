import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { BriefValues } from '@/types';

// GET /api/briefs — list all briefs for current user
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('briefs')
    .select('*')
    .eq('user_id', user.id)
    .order('submitted_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/briefs/code — create a new brief code
// POST /api/briefs/submit — client submits brief (no auth)
// POST /api/briefs/[id]/avatar — build avatar AI
// These are handled in sub-routes below
