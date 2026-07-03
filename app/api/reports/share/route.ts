// POST /api/reports/share — mint a public, client-facing report share-link.
// AUTHENTICATED: the marketer must be logged in and own the client.
// Body: { clientId, periodStart, periodEnd, report } — `report` is the
// already-generated report snapshot from the reports page (stored immutably).
// Returns: { link } pointing at /report/<token>.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { mintReportShare, ReportShareError } from './mint';
import { reportLink } from '@/lib/share';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body → validation fails → 400 */ }

  try {
    const { token } = await mintReportShare(supabase, user.id, {
      clientId:    typeof body?.clientId === 'string' ? body.clientId : null,
      periodStart: typeof body?.periodStart === 'string' ? body.periodStart : null,
      periodEnd:   typeof body?.periodEnd === 'string' ? body.periodEnd : null,
      report:      body?.report ?? null,
    });
    return NextResponse.json({ link: reportLink(token) });
  } catch (err: any) {
    const status = err instanceof ReportShareError ? err.status : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
