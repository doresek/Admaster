// Client workspace (v2) — read-only identity view over the clean `clients`
// model, plus the OPTIONAL Meta-connect card. Meta connect lives here (not on
// the /clients list). Foundation: no legacy meta_clients reads, no orchestrator.
import Link from 'next/link';
import { createClient as createSupabaseClient } from '@/lib/supabase/server';
import { getClient, getClientStrategy } from '@/lib/clients';
import { Card, CardLabel, Alert } from '@/components/ui';
import ConnectFacebookButton from '@/components/meta/ConnectFacebookButton';

export default async function ClientWorkspacePage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <Alert type="amber">התחבר כדי לצפות בלקוח.</Alert>;
  }

  const client = await getClient(supabase, params.id, user.id);
  if (!client) {
    return (
      <div>
        <Alert type="red">הלקוח לא נמצא.</Alert>
        <Link href="/clients" className="text-[#7AC0FF] text-sm">← חזרה ללקוחות</Link>
      </div>
    );
  }

  const strategy = await getClientStrategy(supabase, client.id).catch(() => null);
  const hasBrief = !!strategy?.core_generated_at;

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <Link href="/clients" className="text-[#7AC0FF] text-lg">←</Link>
        <div>
          <div className="text-[11px] font-bold text-[#2E4459] uppercase">לקוח</div>
          <div className="font-bold text-lg">{client.name}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardLabel>פרטי קשר</CardLabel>
          <div className="space-y-1.5 text-sm text-[#D9E8F5]">
            {client.company && <div><span className="text-[#6B8FA8]">חברה: </span>{client.company}</div>}
            {client.phone   && <div dir="ltr" className="text-right"><span className="text-[#6B8FA8]">טלפון: </span>{client.phone}</div>}
            {client.email   && <div dir="ltr" className="text-right"><span className="text-[#6B8FA8]">אימייל: </span>{client.email}</div>}
            {client.notes   && <div className="text-[#6B8FA8] pt-1 border-t border-[#1E2F42] mt-2">{client.notes}</div>}
            {!client.company && !client.phone && !client.email && (
              <div className="text-[#6B8FA8]">אין פרטי קשר נוספים.</div>
            )}
          </div>
        </Card>

        <Card>
          <CardLabel>בריף</CardLabel>
          <div className={`text-sm font-semibold mb-3 ${hasBrief ? 'text-[#34D399]' : 'text-[#6B8FA8]'}`}>
            {hasBrief ? '✓ בריף הושלם' : '○ ממתין לבריף'}
          </div>
          <Link href={`/send-brief?client=${client.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0A7AFF] hover:brightness-110 text-white text-sm font-semibold px-4 py-2 transition-all">
            📋 {hasBrief ? 'שלח בריף נוסף' : 'צור בריף ללקוח'}
          </Link>
        </Card>

        <Card>
          <CardLabel>חיבור Meta (אופציונלי)</CardLabel>
          <div className="text-xs text-[#6B8FA8] mb-3">
            חבר חשבון Facebook/Meta לפרסום. אפשר לדלג ולחבר מאוחר יותר.
          </div>
          <ConnectFacebookButton clientId={client.id} />
        </Card>
      </div>
    </div>
  );
}
