import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// POST /api/auth/logout — server-side sign-out.
//
// A browser-only `supabase.auth.signOut()` clears the client session but does NOT
// reliably clear the httpOnly server cookies @supabase/ssr sets, so middleware keeps
// seeing the user (the "can't sign out / stuck logged in" bug). Signing out through
// the server client here runs its cookie `setAll` adapter, which emits the Set-Cookie
// headers that actually delete the session. The client then hard-navigates so the next
// request is made with the cleared cookies.
export async function POST() {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
