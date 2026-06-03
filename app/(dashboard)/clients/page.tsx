'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Input, Textarea, Btn, Alert, PageHeader, Tabs } from '@/components/ui';
import type { MetaClient } from '@/types';
import { clsx } from 'clsx';

// A CRM client row as returned by GET /api/clients (superset of meta_clients
// surface fields + brief_completion). Meta-only fields (pages/ad_accounts) are
// loaded lazily when the user opens "ניהול מודעות".
interface CrmClient {
  id:               string;
  name:             string;
  emoji:            string;
  email:            string | null;
  phone:            string | null;
  company:          string | null;
  notes:            string | null;
  status:           string | null;
  industry:         string | null;
  brief_completion: number;
}

// ─── CLIENTS PAGE ────────────────────────────────────────────
export default function ClientsPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [clients, setClients] = useState<CrmClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [err,     setErr]     = useState('');

  // New-client modal
  const [showNew, setShowNew] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [form, setForm] = useState({ name:'', email:'', phone:'', company:'', notes:'' });
  const uf = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  // Meta-management workspace (preserves the existing pages/ad-accounts flow)
  const [metaClient, setMetaClient] = useState<MetaClient | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/clients');
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'שגיאה בטעינת לקוחות'); return; }
      setClients(data.clients ?? []);
    } catch {
      setErr('שגיאה בטעינת לקוחות');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function createClientRow() {
    if (!form.name.trim()) { setErr('מלא שם לקוח'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'שגיאה ביצירת לקוח'); return; }
      setClients(p => [data, ...p]);
      setShowNew(false);
      setForm({ name:'', email:'', phone:'', company:'', notes:'' });
    } catch {
      setErr('שגיאה ביצירת לקוח');
    } finally {
      setSaving(false);
    }
  }

  // Open the existing Meta pages/ad-accounts workspace for a client. We load the
  // full meta_clients row (with pages/ad_accounts) on demand to preserve the
  // original connect/selection flow untouched.
  async function openMeta(id: string) {
    setErr('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('meta_clients').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (data) setMetaClient(data as MetaClient);
  }

  async function updateMetaClient(id: string, updates: Partial<MetaClient>) {
    await supabase.from('meta_clients')
      .update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
    setMetaClient(c => c && c.id === id ? { ...c, ...updates } : c);
  }

  if (metaClient) {
    return (
      <ClientWorkspace
        client={metaClient}
        onBack={() => setMetaClient(null)}
        onUpdate={(u) => updateMetaClient(metaClient.id, u)}
      />
    );
  }

  const filtered = clients.filter(c => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.email, c.company].some(v => (v || '').toLowerCase().includes(q));
  });

  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="לקוחות"
        sub="ניהול לקוחות הארגון"
        right={<Btn variant="primary" onClick={() => { setShowNew(true); setErr(''); }}>+ לקוח חדש</Btn>}
      />

      {err && <Alert type="red">{err}</Alert>}

      {/* Search */}
      <div className="mb-4">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 חיפוש לפי שם / אימייל / חברה..."
          dir="rtl"
          className="w-full max-w-md bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-[13px] text-[#D9E8F5] outline-none focus:border-[#0A7AFF] placeholder-[#2E4459] transition-colors"
        />
      </div>

      {loading ? (
        <div className="text-center py-14 text-[#6B8FA8] text-sm">טוען לקוחות...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
          <div className="text-4xl mb-3 opacity-30">👥</div>
          <div className="text-base font-semibold mb-2">
            {clients.length === 0 ? 'אין לקוחות עדיין' : 'לא נמצאו תוצאות'}
          </div>
          {clients.length === 0 && (
            <>
              <div className="text-sm mb-4">צור לקוח ראשון כדי להתחיל בריפינג</div>
              <Btn variant="primary" onClick={() => setShowNew(true)}>+ לקוח חדש</Btn>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(c => (
            <div key={c.id}
              className="bg-[#111A24] border border-[#1E2F42] rounded-xl overflow-hidden hover:border-[#2A4158] transition-all">
              <div className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-[#0A7AFF]/15 border border-[#0A7AFF]/30 flex items-center justify-center text-[#3D9FFF] font-bold text-lg flex-shrink-0">
                    {(c.name || '?').trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[#D9E8F5] truncate">{c.name}</div>
                    {c.company && <div className="text-[11px] text-[#6B8FA8] truncate">🏢 {c.company}</div>}
                  </div>
                </div>
                <div className="space-y-1 mb-3">
                  {c.email && <div className="text-[11px] text-[#6B8FA8] truncate">✉️ {c.email}</div>}
                  {c.phone && <div className="text-[11px] text-[#6B8FA8] truncate" dir="ltr">📞 {c.phone}</div>}
                </div>
                <div className={clsx(
                  'text-[11px] font-medium',
                  c.brief_completion >= 100 ? 'text-[#34D399]'
                  : c.brief_completion > 0  ? 'text-[#D4AF55]'
                  : 'text-[#2E4459]'
                )}>
                  {c.brief_completion >= 100
                    ? `✓ בריפינג הושלם (${c.brief_completion}%)`
                    : c.brief_completion > 0
                      ? `בריפינג בתהליך (${c.brief_completion}%)`
                      : 'ללא בריפינג'}
                </div>
              </div>
              <div className="flex gap-2 px-4 py-3 border-t border-[#1E2F42]">
                <Btn variant="primary" size="sm" full
                  onClick={() => router.push(`/clients/${c.id}/briefing`)}>
                  בריפינג
                </Btn>
                <Btn variant="ghost" size="sm" full onClick={() => openMeta(c.id)}>
                  ניהול מודעות
                </Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New-client modal */}
      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowNew(false)}
        >
          <div
            className="bg-[#111A24] border border-[#1E2F42] rounded-2xl p-6 w-full max-w-md"
            onClick={e => e.stopPropagation()}
            dir="rtl"
          >
            <CardLabel>לקוח חדש</CardLabel>
            <Input label="שם לקוח *" value={form.name}    onChange={v => uf('name', v)}    placeholder="שם העסק / הלקוח" />
            <Input label="אימייל"     value={form.email}   onChange={v => uf('email', v)}   placeholder="name@example.com" type="email" />
            <Input label="טלפון"      value={form.phone}   onChange={v => uf('phone', v)}   placeholder="050-0000000" />
            <Input label="חברה"       value={form.company} onChange={v => uf('company', v)} placeholder="שם החברה" />
            <Textarea label="הערות"   value={form.notes}   onChange={v => uf('notes', v)}   placeholder="הערות פנימיות" rows={3} />
            {err && <Alert type="red">{err}</Alert>}
            <div className="flex gap-2 mt-2">
              <Btn variant="primary" full loading={saving} onClick={createClientRow} disabled={!form.name.trim()}>
                צור לקוח
              </Btn>
              <Btn variant="ghost" onClick={() => setShowNew(false)}>ביטול</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CLIENT WORKSPACE (Meta pages / ad-accounts) ─────────────
// Unchanged from the original page — preserves the Meta connect/selection flow,
// reached via each card's "ניהול מודעות" button.
function ClientWorkspace({ client, onBack, onUpdate }: { client: MetaClient; onBack: ()=>void; onUpdate: (u: Partial<MetaClient>)=>void }) {
  const [tab, setTab] = useState('pages');
  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <Btn variant="ghost" size="sm" onClick={onBack}>←</Btn>
        <div>
          <div className="text-[11px] font-bold text-[#2E4459] uppercase">ניהול מודעות</div>
          <div className="font-bold text-lg">{client.emoji} {client.name}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[{i:'📄',v:client.pages?.length ?? 0,l:'דפים'},{i:'💰',v:client.ad_accounts?.length ?? 0,l:'חשבונות'},{i:'📤',v:client.posts_published,l:'פוסטים'},{i:'🚀',v:client.campaigns_created,l:'קמפיינים'}].map(s=>(
          <div key={s.l} className="bg-[#111A24] border border-[#1E2F42] rounded-lg p-3"><div className="font-mono text-xl">{s.v}</div><div className="text-[11px] text-[#6B8FA8]">{s.l}</div></div>
        ))}
      </div>
      {!client.token && (
        <Alert type="amber">לקוח זה עדיין לא חובר ל-Meta. חבר Token דרך מסך החיבור הקיים כדי לנהל דפים וחשבונות מודעות.</Alert>
      )}
      <Card>
        <Tabs tabs={[{id:'pages',label:'📄 דפים'},{id:'ads',label:'💰 חשבונות מודעות'}]} active={tab} onChange={setTab} />
        {tab==='pages' && (
          <div>
            <div className="text-xs text-[#6B8FA8] mb-3">בחר דף פעיל לפרסום</div>
            {(client.pages?.length ?? 0)===0?<Alert type="amber">לא נמצאו דפים — בדוק הרשאות Token</Alert>:
              client.pages.map(p=>(
                <div key={p.id} onClick={()=>onUpdate({selected_page_id:p.id})}
                  className={`flex items-center gap-3 p-3 rounded-lg border mb-2 cursor-pointer transition-all ${client.selected_page_id===p.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]'}`}>
                  <div className="w-8 h-8 rounded-lg bg-[#1D2D3E] flex items-center justify-center">📘</div>
                  <div><div className="text-sm font-medium">{p.name}</div><div className="text-[11px] text-[#6B8FA8]">{p.fan_count?.toLocaleString()||0} עוקבים · {p.id}</div></div>
                  <div className={`w-4 h-4 rounded-full border ml-auto ${client.selected_page_id===p.id?'border-[#3D9FFF] text-[#3D9FFF] bg-[#0A7AFF]/20 flex items-center justify-center text-[10px]':'border-[#2A4158]'}`}>{client.selected_page_id===p.id?'✓':''}</div>
                </div>
              ))}
          </div>
        )}
        {tab==='ads' && (
          <div>
            <div className="text-xs text-[#6B8FA8] mb-3">בחר חשבון מודעות לקמפיינים</div>
            {(client.ad_accounts?.length ?? 0)===0?<Alert type="amber">לא נמצאו חשבונות — בדוק הרשאות Token</Alert>:
              client.ad_accounts.map(a=>(
                <div key={a.id} onClick={()=>onUpdate({selected_ad_account_id:a.id})}
                  className={`flex items-center gap-3 p-3 rounded-lg border mb-2 cursor-pointer transition-all ${client.selected_ad_account_id===a.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]'}`}>
                  <div className="w-8 h-8 rounded-lg bg-[#1D2D3E] flex items-center justify-center">💰</div>
                  <div><div className="text-sm font-medium">{a.name}</div><div className="text-[11px] text-[#6B8FA8]">{a.currency} · {a.id}</div></div>
                  <div className={`w-4 h-4 rounded-full border ml-auto ${client.selected_ad_account_id===a.id?'border-[#3D9FFF] bg-[#0A7AFF]/20 flex items-center justify-center text-[#3D9FFF] text-[10px]':'border-[#2A4158]'}`}>{client.selected_ad_account_id===a.id?'✓':''}</div>
                </div>
              ))}
          </div>
        )}
      </Card>
    </div>
  );
}
