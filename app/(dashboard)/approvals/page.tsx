'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Textarea, Input, Btn, CopyBtn, Alert, PageHeader, Tabs, Chip } from '@/components/ui';
import type { MetaClient } from '@/types';
import { clsx } from 'clsx';

interface Approval {
  id:           string;
  client_id:    string|null;
  token:        string;
  title:        string|null;
  content:      any;
  status:       'pending'|'approved'|'changes'|'rejected';
  feedback:     string|null;
  created_at:   string;
  responded_at: string|null;
}

const STATUS_LABELS = {
  pending:  { label: 'ממתין',          color: '#0A7AFF', emoji: '⏳' },
  approved: { label: 'אושר',           color: '#059669', emoji: '✅' },
  changes:  { label: 'בקש שינויים',    color: '#D97706', emoji: '✍️' },
  rejected: { label: 'נדחה',           color: '#DC2626', emoji: '❌' },
};

export default function ApprovalsPage() {
  const [tab,       setTab]      = useState('list');
  const [items,     setItems]    = useState<Approval[]>([]);
  const [clients,   setClients]  = useState<MetaClient[]>([]);
  const [selC,      setSelC]     = useState<MetaClient|null>(null);
  const [title,     setTitle]    = useState('');
  const [text,      setText]     = useState('');
  const [imageUrl,  setImageUrl] = useState('');
  const [newLink,   setNewLink]  = useState('');
  const [error,     setError]    = useState('');
  const [loading,   setLoading]  = useState(false);
  const supabase = createClient();

  async function load() {
    const res = await fetch('/api/approvals');
    const data = await res.json();
    setItems(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('meta_clients').select('*').eq('user_id', user.id)
        .then(({ data }) => setClients(data ?? []));
    });
  }, []);

  async function create() {
    if (!text.trim()) return;
    setLoading(true); setError(''); setNewLink('');
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: selC?.id,
          title:     title || null,
          content:   { text, image_url: imageUrl || null },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const url = `${window.location.origin}/approve/${data.token}`;
      setNewLink(url);
      setItems(p => [data.approval, ...p]);
      setText(''); setImageUrl(''); setTitle('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/approvals?id=${id}`, { method: 'DELETE' });
    setItems(p => p.filter(x => x.id !== id));
  }

  const stats = {
    pending:  items.filter(i => i.status === 'pending').length,
    approved: items.filter(i => i.status === 'approved').length,
    changes:  items.filter(i => i.status === 'changes').length,
    rejected: items.filter(i => i.status === 'rejected').length,
  };

  return (
    <div>
      <PageHeader eyebrow="Approvals" title="✅ אישורי לקוח" sub="שלח תכנים לאישור עם דף ציבורי ממותג" />

      <div className="grid grid-cols-4 gap-3 mb-5">
        {Object.entries(stats).map(([k, v]) => {
          const s = STATUS_LABELS[k as keyof typeof STATUS_LABELS];
          return (
            <div key={k} className="bg-[#111A24] border border-[#1E2F42] rounded-lg p-3 text-center">
              <div className="font-mono text-xl font-medium" style={{ color: s.color }}>{v}</div>
              <div className="text-[11px] text-[#6B8FA8] mt-0.5">{s.emoji} {s.label}</div>
            </div>
          );
        })}
      </div>

      <Tabs tabs={[{id:'list',label:`📜 רשימה (${items.length})`},{id:'create',label:'+ צור בקשה'}]} active={tab} onChange={setTab} />

      {tab === 'create' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Card className="mb-3">
              <CardLabel>כותרת</CardLabel>
              <Input value={title} onChange={setTitle} placeholder="לדוגמה: פוסט שבועות 2026" />
            </Card>

            {clients.length > 0 && (
              <Card className="mb-3">
                <CardLabel>לקוח (אופציונלי)</CardLabel>
                <div className="flex flex-wrap gap-2">
                  <Chip label="ללא" active={!selC} onClick={() => setSelC(null)} />
                  {clients.map(c => (
                    <Chip key={c.id} label={`${c.emoji} ${c.name}`} active={selC?.id===c.id} onClick={() => setSelC(c)} />
                  ))}
                </div>
              </Card>
            )}

            <Card className="mb-3">
              <CardLabel>תוכן הפוסט / המודעה</CardLabel>
              <Textarea value={text} onChange={setText} placeholder="הדבק את הטקסט שאתה רוצה שהלקוח יאשר..." rows={8} />
            </Card>

            <Card className="mb-3">
              <CardLabel>URL תמונה (אופציונלי)</CardLabel>
              <Input value={imageUrl} onChange={setImageUrl} placeholder="https://..." />
            </Card>

            <Btn variant="primary" full loading={loading} onClick={create} disabled={!text.trim()}>
              📤 צור קישור אישור
            </Btn>
            {error && <Alert type="red">❌ {error}</Alert>}

            {newLink && (
              <Card className="mt-3" style={{borderColor: 'rgba(184,149,58,.3)'}}>
                <CardLabel>🔗 הקישור מוכן</CardLabel>
                <div className="flex items-center justify-between bg-[#070A0E] border border-[#2A4158] rounded-lg px-3 py-2 mb-2">
                  <span className="text-[11px] font-mono text-[#D4AF55] truncate flex-1" dir="ltr">{newLink}</span>
                  <CopyBtn text={newLink} label="📋 העתק" />
                </div>
                <Alert type="blue">💡 שלח את הקישור ללקוח. הוא יראה את התוכן בדף ממותג ויאשר / ידרוש שינויים / ידחה.</Alert>
              </Card>
            )}
          </div>

          <div>
            {/* Live preview */}
            <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">תצוגה מקדימה — מה הלקוח יראה</div>
            <div className="bg-white text-black rounded-xl overflow-hidden border border-[#2A4158]">
              <div className="bg-gradient-to-r from-[#0A7AFF] to-[#3D9FFF] text-white p-4">
                <div className="text-xs opacity-90">בקשת אישור</div>
                <div className="font-bold">{title || 'תוכן לאישור'}</div>
              </div>
              <div className="p-4">
                {imageUrl && <img src={imageUrl} alt="" className="w-full rounded mb-3" />}
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 min-h-[80px]" dir="rtl">
                  {text || 'התוכן יופיע כאן...'}
                </div>
                <div className="flex gap-2 mt-4 pt-3 border-t">
                  <div className="flex-1 text-center py-2 bg-green-100 text-green-700 rounded text-sm font-bold">✅ אשר</div>
                  <div className="flex-1 text-center py-2 bg-amber-100 text-amber-700 rounded text-sm font-bold">✍️ בקש שינויים</div>
                  <div className="flex-1 text-center py-2 bg-red-100 text-red-700 rounded text-sm font-bold">❌ דחה</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <div>
          {items.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <div className="text-4xl mb-3 opacity-30">📭</div>
              <div className="text-sm mb-4">עוד לא שלחת בקשות אישור</div>
              <Btn variant="primary" onClick={() => setTab('create')}>+ צור בקשה ראשונה</Btn>
            </div>
          ) : (
            items.map(item => {
              const s = STATUS_LABELS[item.status];
              const url = typeof window !== 'undefined' ? `${window.location.origin}/approve/${item.token}` : '';
              return (
                <div key={item.id} className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 mb-2">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full')}
                          style={{background: `${s.color}15`, color: s.color, border: `1px solid ${s.color}33`}}>
                          {s.emoji} {s.label}
                        </span>
                        <span className="text-xs text-[#D9E8F5] truncate">{item.title || 'ללא כותרת'}</span>
                      </div>
                      <div className="text-[11px] text-[#6B8FA8] truncate">{item.content?.text?.substring(0, 100)}</div>
                      {item.feedback && (
                        <div className="mt-2 bg-[#D97706]/10 border border-[#D97706]/20 text-[#D97706] text-xs rounded-lg px-2.5 py-1.5">
                          💬 פידבק: {item.feedback}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 items-end">
                      <CopyBtn text={url} label="🔗 קישור" />
                      {item.status === 'approved' && (
                        <a href={`/ads-launcher?approval=${item.id}`}
                          className="text-[10px] font-bold text-[#3D9FFF] hover:underline whitespace-nowrap">🚀 השק כקמפיין</a>
                      )}
                      <button onClick={() => remove(item.id)} className="text-[10px] text-[#2E4459] hover:text-red-400">✕ מחק</button>
                    </div>
                  </div>
                  <div className="text-[10px] text-[#2E4459]">
                    נוצר: {new Date(item.created_at).toLocaleString('he')}
                    {item.responded_at && ` · נענה: ${new Date(item.responded_at).toLocaleString('he')}`}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
