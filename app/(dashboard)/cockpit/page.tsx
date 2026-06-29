// app/(dashboard)/cockpit/page.tsx
// Beginner home: the per-client journey cockpit with the "do it for me" autopilot.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import { ACTIVE_CLIENT_COOKIE, readActiveClientCookie } from '@/lib/active-client';
import { getJourney } from '@/lib/journey';
import { CockpitBoard } from '@/components/cockpit/CockpitBoard';

export const metadata = { title: 'קוקפיט' };

export default async function CockpitPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const c = cookies();
  const clientId = readActiveClientCookie(`${ACTIVE_CLIENT_COOKIE}=${c.get(ACTIVE_CLIENT_COOKIE)?.value ?? ''}`);

  const journey = await getJourney(supabase, user.id, clientId);

  let clientName: string | null = null;
  if (clientId) {
    const { data } = await supabase.from('clients').select('name').eq('id', clientId).eq('owner_user_id', user.id).maybeSingle();
    clientName = data?.name ?? null;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        eyebrow="AUTOPILOT"
        title="קוקפיט"
        sub="המסע של הלקוח מקצה לקצה — תן ל-AI לעשות את העבודה, אתה מאשר."
      />
      <CockpitBoard initialJourney={journey} clientId={clientId} clientName={clientName} />
    </div>
  );
}
