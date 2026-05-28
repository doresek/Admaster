'use client';
import { useState, useEffect } from 'react';
import { Card, CardLabel, Btn, Input, Textarea, Alert, PageHeader, Chip, Tabs } from '@/components/ui';
import { clsx } from 'clsx';

interface Ticket {
  id:         string;
  subject:    string;
  category:   string;
  status:     'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  priority:   'low' | 'normal' | 'high' | 'urgent';
  created_at: string;
  updated_at: string;
}

interface Message {
  id:         string;
  body:       string;
  is_staff:   boolean;
  created_at: string;
}

const CATEGORIES = [
  { id: 'general',         label: '💬 כללי' },
  { id: 'billing',         label: '💳 חיוב' },
  { id: 'bug',             label: '🐛 באג' },
  { id: 'feature_request', label: '💡 בקשה' },
  { id: 'meta_api',        label: '🔌 Meta API' },
  { id: 'other',           label: '📦 אחר' },
];

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  open:        { label: 'פתוח',        color: '#0A7AFF' },
  in_progress: { label: 'בטיפול',      color: '#D97706' },
  waiting:     { label: 'ממתין',       color: '#B8953A' },
  resolved:    { label: 'נפתר',        color: '#059669' },
  closed:      { label: 'סגור',         color: '#6B8FA8' },
};

export default function SupportPage() {
  const [tab,      setTab]      = useState<'list' | 'new'>('list');
  const [tickets,  setTickets]  = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply,    setReply]    = useState('');

  // new ticket form
  const [subject,  setSubject]  = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [body,     setBody]     = useState('');
  const [creating, setCreating] = useState(false);
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState('');

  async function loadList() {
    const res  = await fetch('/api/support');
    const data = await res.json();
    setTickets(Array.isArray(data) ? data : []);
  }

  async function openTicket(t: Ticket) {
    setSelected(t);
    const res = await fetch(`/api/support?id=${t.id}`);
    const d   = await res.json();
    setMessages(d.messages || []);
  }

  useEffect(() => { loadList(); }, []);

  async function createTicket() {
    if (!subject.trim() || !body.trim()) return;
    setCreating(true); setError('');
    try {
      const res = await fetch('/api/support', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, category, priority, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTickets(p => [data, ...p]);
      setSubject(''); setBody('');
      setTab('list');
      openTicket(data);
    } catch (e: any) { setError(e.message); }
    finally { setCreating(false); }
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/support', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: selected.id, body: reply }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessages(p => [...p, data]);
        setReply('');
      }
    } finally { setSending(false); }
  }

  async function closeTicket(id: string) {
    if (!confirm('לסגור את הפנייה?')) return;
    const res = await fetch(`/api/support?id=${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: 'closed' }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTickets(p => p.map(t => t.id === id ? updated : t));
      if (selected?.id === id) setSelected(updated);
    }
  }

  // Detail view
  if (selected) {
    const s = STATUS_STYLE[selected.status];
    return (
      <div>
        <div className="flex items-center gap-3 mb-5">
          <Btn variant="ghost" size="sm" onClick={() => { setSelected(null); setMessages([]); }}>← חזרה</Btn>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-[#D9E8F5]">{selected.subject}</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                style={{ background: `${s.color}15`, color: s.color, borderColor: `${s.color}40` }}>
                {s.label}
              </span>
            </div>
            <div className="text-[11px] text-[#2E4459]">
              {CATEGORIES.find(c => c.id === selected.category)?.label} · נפתח {new Date(selected.created_at).toLocaleString('he')}
            </div>
          </div>
          {selected.status !== 'closed' && (
            <Btn variant="ghost" size="sm" onClick={() => closeTicket(selected.id)}>סגור פנייה</Btn>
          )}
        </div>

        <div className="space-y-3 mb-4">
          {messages.map(m => (
            <div key={m.id} className={clsx('rounded-xl p-4', m.is_staff
              ? 'bg-[#0A7AFF]/8 border border-[#0A7AFF]/25'
              : 'bg-[#152138] border border-[#243752]')}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-bold uppercase" style={{ color: m.is_staff ? '#3D9FFF' : '#6B8FA8' }}>
                  {m.is_staff ? '🛟 צוות AdMaster' : 'אתה'}
                </div>
                <div className="text-[10px] text-[#2E4459]">{new Date(m.created_at).toLocaleString('he')}</div>
              </div>
              <div className="text-[13px] leading-relaxed text-[#D9E8F5] whitespace-pre-wrap">{m.body}</div>
            </div>
          ))}
        </div>

        {selected.status !== 'closed' && (
          <Card>
            <CardLabel>שלח תגובה</CardLabel>
            <Textarea value={reply} onChange={setReply} placeholder="הקלד תגובה..." rows={4} />
            <Btn variant="primary" loading={sending} onClick={sendReply} disabled={!reply.trim()}>📤 שלח</Btn>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader eyebrow="Support" title="🎫 תמיכה" sub="פנו אלינו ונחזור אליכם תוך 24 שעות" />

      <Tabs tabs={[{id:'list',label:`📜 הפניות שלי (${tickets.length})`},{id:'new',label:'+ פנייה חדשה'}]} active={tab} onChange={t => setTab(t as any)} />

      {tab === 'list' && (
        <div>
          {tickets.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
              <div className="text-4xl mb-3 opacity-30">📭</div>
              <div className="text-base font-semibold mb-2">אין פניות פתוחות</div>
              <div className="text-sm mb-4">פתחו פנייה חדשה ונחזור אליכם</div>
              <Btn variant="primary" onClick={() => setTab('new')}>+ פנייה חדשה</Btn>
            </div>
          ) : (
            tickets.map(t => {
              const s = STATUS_STYLE[t.status];
              return (
                <div key={t.id} onClick={() => openTicket(t)}
                  className="bg-[#152138] border border-[#243752] rounded-xl p-4 mb-2 cursor-pointer hover:border-[#324C6B] hover:-translate-x-0.5 transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                          style={{ background: `${s.color}15`, color: s.color, borderColor: `${s.color}40` }}>
                          {s.label}
                        </span>
                        <span className="text-[10px] text-[#6B8FA8]">{CATEGORIES.find(c => c.id === t.category)?.label}</span>
                      </div>
                      <div className="font-semibold text-sm text-[#D9E8F5] truncate">{t.subject}</div>
                    </div>
                    <div className="text-[10px] text-[#2E4459] flex-shrink-0">
                      {new Date(t.updated_at).toLocaleDateString('he')}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'new' && (
        <Card>
          <Input label="נושא הפנייה" value={subject} onChange={setSubject} placeholder="לדוגמה: בעיה בחיבור ל-Meta Ad Account" />

          <CardLabel>קטגוריה</CardLabel>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {CATEGORIES.map(c => (
              <Chip key={c.id} label={c.label} active={category===c.id} onClick={() => setCategory(c.id)} />
            ))}
          </div>

          <CardLabel>דחיפות</CardLabel>
          <div className="flex gap-1.5 mb-3">
            {[
              { id:'low',    label:'🟢 נמוכה' },
              { id:'normal', label:'🟡 רגילה' },
              { id:'high',   label:'🟠 גבוהה' },
              { id:'urgent', label:'🔴 דחוף' },
            ].map(p => (
              <Chip key={p.id} label={p.label} active={priority===p.id} onClick={() => setPriority(p.id as any)} />
            ))}
          </div>

          <Textarea label="פירוט הבעיה" value={body} onChange={setBody}
            placeholder="תאר את הבעיה / השאלה בפירוט. ככל שיותר context, כך נוכל לעזור מהר יותר."
            rows={6} />

          {error && <Alert type="red">❌ {error}</Alert>}

          <Btn variant="primary" full loading={creating} onClick={createTicket} disabled={!subject.trim() || !body.trim()}>
            📤 שלח פנייה
          </Btn>

          <div className="mt-4 text-center">
            <a href="https://chat.whatsapp.com/" target="_blank" rel="noreferrer" className="text-xs text-[#34D399] hover:underline">
              💬 או הצטרף לקהילת ה-WhatsApp לתמיכה מהירה
            </a>
          </div>
        </Card>
      )}
    </div>
  );
}
