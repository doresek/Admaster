'use client';
// Shared by clients.tsx, publish.tsx, campaign.tsx
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Input, Textarea, Btn, Alert, PageHeader, CostBadge, Tabs } from '@/components/ui';
import { useAI, useMeta } from '@/lib/hooks/useAI';
import ConnectFacebookButton from '@/components/meta/ConnectFacebookButton';
import type { MetaClient, MetaConnection, MetaPage, MetaAdAccount } from '@/types';
import { clsx } from 'clsx';

// meta_clients is pure identity now; the credential + assets (pages, ad
// accounts, active selection, live status) live on the active meta_connections
// child row. This view merges the active connection over the client so the UI
// renders from the connection when one exists, and falls back to the legacy
// meta_clients fields for clients connected before the meta_connections backfill.
interface ClientView {
  pages: MetaPage[];
  ad_accounts: MetaAdAccount[];
  selected_page_id: string | null;
  selected_ad_account_id: string | null;
  status: string;
  meta_user_name: string | null;
}

function clientView(client: MetaClient, conn?: MetaConnection): ClientView {
  if (conn) {
    return {
      pages: conn.pages ?? [],
      ad_accounts: conn.ad_accounts ?? [],
      selected_page_id: conn.selected_page_id,
      selected_ad_account_id: conn.selected_ad_account_id,
      status: conn.status,
      meta_user_name: conn.meta_user_name ?? client.meta_user_name,
    };
  }
  return {
    pages: client.pages ?? [],
    ad_accounts: client.ad_accounts ?? [],
    selected_page_id: client.selected_page_id,
    selected_ad_account_id: client.selected_ad_account_id,
    status: client.status,
    meta_user_name: client.meta_user_name,
  };
}

function useClients() {
  const [clients, setClients] = useState<MetaClient[]>([]);
  // clientId → active (most-recently-connected) connection.
  const [connections, setConnections] = useState<Record<string, MetaConnection>>({});
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: cls } = await supabase.from('meta_clients').select('*').eq('user_id', user.id);
      setClients(cls ?? []);

      // Active connections for this agency user, newest first; keep the first
      // (most recent) per client. RLS (meta_connections_own) scopes to the user.
      const { data: conns } = await supabase
        .from('meta_connections')
        .select('id, client_id, token_encrypted, meta_user_id, meta_user_name, pages, ad_accounts, selected_page_id, selected_ad_account_id, status, connected_at')
        .eq('agency_user_id', user.id)
        .eq('status', 'connected')
        .order('connected_at', { ascending: false });

      const map: Record<string, MetaConnection> = {};
      for (const c of (conns ?? []) as MetaConnection[]) if (!map[c.client_id]) map[c.client_id] = c;
      setConnections(map);
    });
  }, []);

  // Adds a new Meta client via the secure server endpoint. The token is
  // verified, encrypted and stored server-side — never sent to the DB
  // in plaintext from the browser.
  async function addClient(input: { name: string; industry?: string; emoji?: string; token: string }) {
    const res  = await fetch('/api/meta/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'שגיאה בחיבור');
    setClients(p => [...p, data]);
    return data;
  }

  // Update the active page / ad-account selection. Writes to the active
  // meta_connections row when one exists (.eq('id', connection.id)); otherwise
  // falls back to the legacy meta_clients columns for pre-backfill clients.
  async function updateSelection(
    clientId: string,
    updates: { selected_page_id?: string; selected_ad_account_id?: string },
  ) {
    const conn = connections[clientId];
    if (conn) {
      await supabase.from('meta_connections').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', conn.id);
      setConnections(p => ({ ...p, [clientId]: { ...p[clientId], ...updates } }));
    } else {
      await supabase.from('meta_clients').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', clientId);
      setClients(p => p.map(c => c.id === clientId ? { ...c, ...updates } : c));
    }
  }

  return { clients, connections, setClients, addClient, updateSelection };
}

// ─── CLIENTS PAGE ────────────────────────────────────────────
export default function ClientsPage() {
  const { clients, connections, addClient, updateSelection } = useClients();
  const [form, setForm]    = useState({ name:'', industry:'', emoji:'🏢', token:'' });
  const [showForm, setShowForm] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [err, setErr]      = useState('');
  const [selC, setSelC]    = useState<MetaClient|null>(null);
  const uf = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const searchParams = useSearchParams();

  // Returning from the Meta OAuth callback (/clients?meta=...&client=<id>):
  // re-open that client's workspace so the ConnectFacebookButton status banner
  // is shown right where the user started the connect.
  useEffect(() => {
    const id = searchParams?.get('client');
    if (!id || selC) return;
    const match = clients.find(c => c.id === id);
    if (match) setSelC(match);
  }, [searchParams, clients]); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    if (!form.name || !form.token) { setErr('מלא שם וToken'); return; }
    setConnecting(true); setErr('');
    try {
      await addClient(form);
      setShowForm(false);
      setForm({ name:'', industry:'', emoji:'🏢', token:'' });
    } catch (e: any) {
      setErr('שגיאת חיבור: ' + e.message);
    } finally {
      setConnecting(false); }
  }

  if (selC) return <ClientWorkspace client={selC} connection={connections[selC.id]} onBack={() => setSelC(null)} onUpdate={(u) => updateSelection(selC.id, u)} />;

  return (
    <div>
      <PageHeader eyebrow="Meta API" title="לקוחות Meta" sub={`${clients.length} לקוחות מחוברים`}
        right={<Btn variant="primary" onClick={() => setShowForm(!showForm)}>+ הוסף לקוח</Btn>} />

      {showForm && (
        <Card className="mb-4">
          <CardLabel>🔌 חיבור Meta חדש</CardLabel>
          <Alert type="blue">הToken נשמר מאובטח בDB ומעולם לא נחשף ללקוח</Alert>
          <div className="flex flex-wrap gap-2 mb-3">
            {['🏢','✡️','🕍','🛍','💎','📚','🏋','🎨'].map(e => (
              <button key={e} onClick={() => uf('emoji', e)}
                className={clsx('w-9 h-9 rounded-lg text-lg transition-all', form.emoji===e ? 'bg-[#0A7AFF]/20 border border-[#0A7AFF]' : 'bg-[#162030] border border-[#1E2F42] hover:border-[#2A4158]')}>
                {e}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="שם לקוח *"  value={form.name}     onChange={v=>uf('name',v)}     placeholder="שם העסק" />
            <Input label="תחום"        value={form.industry} onChange={v=>uf('industry',v)} placeholder="תחום עיסוק" />
          </div>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-[#6B8FA8]">Meta Access Token *</label>
              <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer"
                className="text-[11px] text-[#3D9FFF] hover:underline">❓ איך מקבלים?</a>
            </div>
            <input type="password" value={form.token} onChange={e=>uf('token',e.target.value)} placeholder="EAAxxxxxxxx..."
              className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF]"
              dir="ltr" />
          </div>
          {err && <Alert type="red">{err}</Alert>}
          <Btn variant="primary" loading={connecting} onClick={connect} disabled={!form.name||!form.token}>
            🔗 חבר לקוח
          </Btn>
        </Card>
      )}

      {clients.length === 0 && !showForm && (
        <div className="text-center py-14 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
          <div className="text-4xl mb-3 opacity-30">🔌</div>
          <div className="text-base font-semibold mb-2">אין לקוחות מחוברים</div>
          <div className="text-sm mb-4">חבר לקוח עם Meta Access Token</div>
          <Btn variant="primary" onClick={() => setShowForm(true)}>+ חבר לקוח ראשון</Btn>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {clients.map(c => {
          const v = clientView(c, connections[c.id]);
          return (
          <div key={c.id} onClick={() => setSelC(c)}
            className="bg-[#111A24] border border-[#1E2F42] rounded-xl overflow-hidden cursor-pointer hover:border-[#0A7AFF] hover:-translate-y-0.5 transition-all">
            <div className="p-3.5 flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[#1D2D3E] border border-[#2A4158] flex items-center justify-center text-lg flex-shrink-0">{c.emoji}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{c.name}</div>
                <div className="text-[11px] text-[#6B8FA8] truncate">{c.industry}</div>
                <div className="text-[10px] text-[#2E4459] mt-0.5">{v.meta_user_name}</div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <div className={`w-1.5 h-1.5 rounded-full ${v.status==='connected'?'bg-[#059669]':'bg-red-500'}`} />
                <span className={`text-[10px] font-bold ${v.status==='connected'?'text-[#059669]':'text-red-400'}`}>{v.status==='connected'?'פעיל':'שגיאה'}</span>
              </div>
            </div>
            <div className="flex gap-3 px-3.5 py-2 border-t border-[#1E2F42]">
              <div className="text-[10px] text-[#6B8FA8]"><strong className="text-[#D9E8F5] text-xs">{v.pages.length}</strong> דפים</div>
              <div className="text-[10px] text-[#6B8FA8]"><strong className="text-[#D9E8F5] text-xs">{v.ad_accounts.length}</strong> חשבונות</div>
              <div className="text-[10px] text-[#6B8FA8]"><strong className="text-[#D9E8F5] text-xs">{c.posts_published}</strong> פוסטים</div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CLIENT WORKSPACE ────────────────────────────────────────
function ClientWorkspace({ client, connection, onBack, onUpdate }: { client: MetaClient; connection?: MetaConnection; onBack: ()=>void; onUpdate: (u: { selected_page_id?: string; selected_ad_account_id?: string })=>void }) {
  const [tab, setTab] = useState('pages');
  // Pages / ad accounts / selection come from the active connection when one
  // exists, else from the legacy meta_clients fields (pre-backfill clients).
  const v = clientView(client, connection);
  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <Btn variant="ghost" size="sm" onClick={onBack}>←</Btn>
        <div>
          <div className="text-[11px] font-bold text-[#2E4459] uppercase">לקוח Meta</div>
          <div className="font-bold text-lg">{client.emoji} {client.name}</div>
        </div>
        {/* Per-client OAuth connect/reconnect — uses this client's id. */}
        <div className="ml-auto"><ConnectFacebookButton clientId={client.id} /></div>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[{i:'📄',v:v.pages.length,l:'דפים'},{i:'💰',v:v.ad_accounts.length,l:'חשבונות'},{i:'📤',v:client.posts_published,l:'פוסטים'},{i:'🚀',v:client.campaigns_created,l:'קמפיינים'}].map(s=>(
          <div key={s.l} className="bg-[#111A24] border border-[#1E2F42] rounded-lg p-3"><div className="font-mono text-xl">{s.v}</div><div className="text-[11px] text-[#6B8FA8]">{s.l}</div></div>
        ))}
      </div>
      <Card>
        <Tabs tabs={[{id:'pages',label:'📄 דפים'},{id:'ads',label:'💰 חשבונות מודעות'}]} active={tab} onChange={setTab} />
        {tab==='pages' && (
          <div>
            <div className="text-xs text-[#6B8FA8] mb-3">בחר דף פעיל לפרסום</div>
            {v.pages.length===0?<Alert type="amber">לא נמצאו דפים — בדוק הרשאות Token</Alert>:
              v.pages.map(p=>(
                <div key={p.id} onClick={()=>onUpdate({selected_page_id:p.id})}
                  className={`flex items-center gap-3 p-3 rounded-lg border mb-2 cursor-pointer transition-all ${v.selected_page_id===p.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]'}`}>
                  <div className="w-8 h-8 rounded-lg bg-[#1D2D3E] flex items-center justify-center">📘</div>
                  <div><div className="text-sm font-medium">{p.name}</div><div className="text-[11px] text-[#6B8FA8]">{p.fan_count?.toLocaleString()||0} עוקבים · {p.id}</div></div>
                  <div className={`w-4 h-4 rounded-full border ml-auto ${v.selected_page_id===p.id?'border-[#3D9FFF] text-[#3D9FFF] bg-[#0A7AFF]/20 flex items-center justify-center text-[10px]':'border-[#2A4158]'}`}>{v.selected_page_id===p.id?'✓':''}</div>
                </div>
              ))}
          </div>
        )}
        {tab==='ads' && (
          <div>
            <div className="text-xs text-[#6B8FA8] mb-3">בחר חשבון מודעות לקמפיינים</div>
            {v.ad_accounts.length===0?<Alert type="amber">לא נמצאו חשבונות — בדוק הרשאות Token</Alert>:
              v.ad_accounts.map(a=>(
                <div key={a.id} onClick={()=>onUpdate({selected_ad_account_id:a.id})}
                  className={`flex items-center gap-3 p-3 rounded-lg border mb-2 cursor-pointer transition-all ${v.selected_ad_account_id===a.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]'}`}>
                  <div className="w-8 h-8 rounded-lg bg-[#1D2D3E] flex items-center justify-center">💰</div>
                  <div><div className="text-sm font-medium">{a.name}</div><div className="text-[11px] text-[#6B8FA8]">{a.currency} · {a.id}</div></div>
                  <div className={`w-4 h-4 rounded-full border ml-auto ${v.selected_ad_account_id===a.id?'border-[#3D9FFF] bg-[#0A7AFF]/20 flex items-center justify-center text-[#3D9FFF] text-[10px]':'border-[#2A4158]'}`}>{v.selected_ad_account_id===a.id?'✓':''}</div>
                </div>
              ))}
          </div>
        )}
      </Card>
    </div>
  );
}
