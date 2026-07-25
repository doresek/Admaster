// app/brief/[token]/page.tsx
// Public-facing brief wizard. No auth required; access is by 64-hex token.

import { createAdminClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import BriefWizard from './BriefWizard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TOKEN_REGEX = /^[a-f0-9]{64}$/;

export default async function BriefPage({
  params,
}: {
  params: { token: string };
}) {
  // Cheap rejection of malformed tokens — saves a DB roundtrip on bot traffic.
  if (!TOKEN_REGEX.test(params.token)) {
    notFound();
  }

  const admin = createAdminClient();

  // Fetch brief by token. We use the admin client because client requests
  // come in unauthenticated; the token IS the authorization.
  const { data: brief, error } = await admin
    .from('briefs')
    .select(
      'id, token, user_id, client_name, values, current_step, progress_pct, status, expires_at, opened_at'
    )
    .eq('token', params.token)
    .maybeSingle();

  if (error || !brief) {
    notFound();
  }

  // Expiry check
  if (brief.expires_at && new Date(brief.expires_at) < new Date()) {
    return <ExpiredView />;
  }

  // Already-submitted → show thank-you, don't allow re-edit
  if (
    brief.status === 'submitted' ||
    brief.status === 'has_avatar' ||
    brief.status === 'complete'
  ) {
    return <AlreadySubmittedView />;
  }

  // Get agency info for branding (name only for now; full white-label later)
  const { data: agency } = await admin
    .from('users')
    .select('name, brand')
    .eq('id', brief.user_id)
    .maybeSingle();

  // Side-effect: mark as opened on first visit. We intentionally don't await
  // the failure case — if this fails it doesn't break the page render.
  if (brief.status === 'sent' && !brief.opened_at) {
    void admin
      .from('briefs')
      .update({ status: 'opened', opened_at: new Date().toISOString() })
      .eq('id', brief.id);
  }

  return (
    <BriefWizard
      token={params.token}
      briefId={brief.id}
      initialData={(brief.values as Record<string, unknown>) || {}}
      initialStep={brief.current_step || 1}
      agencyName={agency?.name || 'הסוכנות'}
      clientName={brief.client_name}
    />
  );
}

// ---------------------------------------------------------------------------
// Plain-state views (expired, already submitted)
// ---------------------------------------------------------------------------

function ExpiredView() {
  return (
    <div
      className="min-h-screen bg-stone-50 flex items-center justify-center p-6"
      dir="rtl"
    >
      <div className="bg-white rounded-3xl border border-stone-200 max-w-md w-full p-10 text-center shadow-sm">
        <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-5">
          <svg
            className="w-7 h-7 text-amber-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-serif text-stone-900 mb-2">
          הקישור פג תוקף
        </h1>
        <p className="text-stone-600 leading-relaxed">
          בקש מהסוכן שלך לשלוח לך קישור חדש.
        </p>
      </div>
    </div>
  );
}

function AlreadySubmittedView() {
  return (
    <div
      className="min-h-screen bg-stone-50 flex items-center justify-center p-6"
      dir="rtl"
    >
      <div className="bg-white rounded-3xl border border-stone-200 max-w-md w-full p-10 text-center shadow-sm">
        <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-5">
          <svg
            className="w-7 h-7 text-emerald-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-serif text-stone-900 mb-2">
          הבריף כבר הוגש
        </h1>
        <p className="text-stone-600 leading-relaxed">
          תודה! הסוכן שלך כבר התחיל לעבוד על המודעות.
        </p>
      </div>
    </div>
  );
}
