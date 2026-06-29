'use client';
// Clients (v2) — contact-first client list over the clean `clients` model.
// Identity ONLY: name + contact fields. Meta connect is NOT here — it stays an
// optional card on the client workspace (ConnectFacebookButton). Creation posts
// to /api/clients (never /api/meta/clients), which never touches Meta/Graph.
import { useState, useEffect } from 'react';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { Card, CardLabel, Input, Textarea, Btn, Alert, PageHeader } from '@/components/ui';
import { canCreateClient } from '@/lib/clients';
import type { Client } from '@/types';

// Initials avatar from the client name (first letters of up to two words).
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] + parts[1][0]);
}

interface NewClientForm {
  name: string; phone: string; email: string; company: string; notes: string;
}
const EMPTY_FORM: NewClientForm = { name: '', phone: '', email: '', company: '', notes: '' };

function useClients() {
  const [clients, setClients] = useState<Client[]>([]);
  // clientId → has a generated strategy core (brief completed). Best-effort:
  // the new client_strategy table may not exist yet, so failures are ignored.
  const [briefed, setBriefed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/clients');
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setClients(data);
    } catch { /* surfaced as empty list */ }
    setLoading(false);

    // Brief-status overlay — tolerant of a missing/empty strategy table.
    try {
      const supabase = createSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: rows } = await supabase
        .from('client_strategy')
        .select('client_id, core_generated_at')
        .eq('owner_user_id', user.id);
      const map: Record<string, boolean> = {};
      for (const r of (rows ?? []) as { client_id: string; core_generated_at: string | null }[]) {
        map[r.client_id] = !!r.core_generated_at;
      }
      setBriefed(map);
    } catch { /* table not present yet — treat all as un-briefed */ }
  }

  useEffect(() => { load(); }, []);

  async function addClient(input: NewClientForm): Promise<Client> {
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        phone: input.phone || undefined,
        email: input.email || undefined,
        company: input.company || undefined,
        notes: input.notes || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'שגיאה ביצירת לקוח');
    setClients(p => [data, ...p]);
    return data;
  }

  return { clients, briefed, loading, addClient };
}

export default function ClientsPage() {
  const { clients, briefed, loading, addClient } = useClients();
  const [form, setForm] = useState<NewClientForm>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<Client | null>(null);
  const uf = (k: keyof NewClientForm, v: string) => setForm(p => ({ ...p, [k]: v }));

  async function submit() {
    if (!canCreateClient(form.name)) { setErr('מלא שם לקוח'); return; }
    setSaving(true); setErr('');
    try {
      const c = await addClient(form);
      setShowForm(false);
      setForm(EMPTY_FORM);
      setCreated(c);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="לקוחות" sub={`${clients.length} לקוחות`}
        right={<Btn variant="primary" onClick={() => { setShowForm(s => !s); setErr(''); }}>+ לקוח חדש</Btn>} />

      {created && (
        <Card className="mb-4" style={{ borderColor: 'rgba(10,122,255,.3)' }}>
          <CardLabel>🎉 הלקוח {created.name} נוצר!</CardLabel>
          <div className="text-sm text-[#6B8FA8] mb-3">
            השלב הבא: שלח ללקוח בריף קצר — מילוי הבריף בונה אוטומטית אווטאר, מודעות ומשפך.
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/send-brief?client=${created.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0A7AFF] hover:brightness-110 text-white text-sm font-semibold px-4 py-2 transition-all">
              📋 צור בריף ללקוח
            </a>
            <Btn variant="ghost" size="sm" onClick={() => setCreated(null)}>סגור</Btn>
          </div>
        </Card>
      )}

      {showForm && (
        <Card className="mb-4">
          <CardLabel>➕ לקוח חדש</CardLabel>
          <div className="grid grid-cols-2 gap-x-3">
            <Input label="שם *"   value={form.name}    onChange={v => uf('name', v)}    placeholder="שם הלקוח / העסק" />
            <Input label="טלפון"  value={form.phone}   onChange={v => uf('phone', v)}   placeholder="050-0000000" type="tel" />
            <Input label="אימייל" value={form.email}   onChange={v => uf('email', v)}   placeholder="name@example.com" type="email" />
            <Input label="חברה"   value={form.company} onChange={v => uf('company', v)} placeholder="שם החברה" />
          </div>
          <Textarea label="הערות" value={form.notes} onChange={v => uf('notes', v)} placeholder="הערות פנימיות על הלקוח" rows={3} />
          {err && <Alert type="red">{err}</Alert>}
          <Btn variant="primary" loading={saving} onClick={submit} disabled={!canCreateClient(form.name)}>
            צור לקוח
          </Btn>
        </Card>
      )}

      {!loading && clients.length === 0 && !showForm && (
        <div className="text-center py-14 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
          <div className="text-4xl mb-3 opacity-30">📋</div>
          <div className="text-base font-semibold mb-2">אין לקוחות עדיין</div>
          <div className="text-sm mb-4">צור לקוח בשם בלבד — את חשבון ה-Meta אפשר לחבר מאוחר יותר מתוך כרטיס הלקוח</div>
          <Btn variant="primary" onClick={() => setShowForm(true)}>+ צור לקוח ראשון</Btn>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {clients.map(c => {
          const hasBrief = briefed[c.id];
          return (
            <a key={c.id} href={`/clients/${c.id}`}
              className="bg-[#111A24] border border-[#1E2F42] rounded-xl overflow-hidden cursor-pointer hover:border-[#0A7AFF] hover:-translate-y-0.5 transition-all">
              <div className="p-3.5 flex items-start gap-2.5">
                <div className="w-10 h-10 rounded-full bg-[#1D2D3E] border border-[#2A4158] flex items-center justify-center text-sm font-bold text-[#7AC0FF] flex-shrink-0 uppercase">
                  {initials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{c.name}</div>
                  {c.company && <div className="text-[11px] text-[#6B8FA8] truncate">{c.company}</div>}
                  <div className="text-[11px] text-[#6B8FA8] truncate" dir="ltr">{c.phone || c.email || ''}</div>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1D2D3E] text-[#6B8FA8] flex-shrink-0">לא מחובר</span>
              </div>
              <div className="flex items-center gap-2 px-3.5 py-2 border-t border-[#1E2F42]">
                <span className={`text-[10px] font-semibold ${hasBrief ? 'text-[#34D399]' : 'text-[#6B8FA8]'}`}>
                  {hasBrief ? '✓ בריף הושלם' : '○ ממתין לבריף'}
                </span>
                <span className="ml-auto flex gap-2">
                  <span className="text-[11px] text-[#7AC0FF]">פתח</span>
                  <span className="text-[11px] text-[#6B8FA8]"
                    onClick={(e) => { e.preventDefault(); window.location.href = `/send-brief?client=${c.id}`; }}>
                    בריפינג
                  </span>
                </span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
