import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  const { name, email, subject, message } = await req.json();
  if (!name || !email || !message) {
    return NextResponse.json({ error: 'חסרים שדות חובה' }, { status: 400 });
  }

  // Use service-role-less client; "contacts" table is public-insert
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    }
  );

  const { error } = await supabase.from('contacts').insert({
    name, email, subject: subject ?? null, message,
  });

  if (error) {
    // Don't leak DB details to the public form
    console.error('[contact]', error);
    return NextResponse.json({ error: 'שגיאה בשרת' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
