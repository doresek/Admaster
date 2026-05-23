'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Textarea, Btn, Alert, PageHeader } from '@/components/ui';
import type { MetaClient } from '@/types';
import { clsx } from 'clsx';

const DAYS_HE = ['א','ב','ג','ד','ה','ו','ש'];
const MONTHS_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const STATUS_COLORS: Record<string, string> = {
  scheduled: '#0A7AFF', published: '#059669', failed: '#DC2626', cancelled: '#6B8FA8',
};

export default function SchedulePage() {
  const [clients,    setClients]   = useState<MetaClient[]>([]);
  const [selC,       setSelC]      = useState<MetaClient|null>(null);
  const [year,       setYear]      = useState(new Date().getFullYear());
  const [month,      setMonth]     = useState(new Date().getMonth());
  const [posts,      setPosts]     = useState<any[]>([]);
  const [selDay,     setSelDay]    = useState<number|null>(null);
  const [showForm,   setShowForm]  = useState(false);
  const [form,       setForm]      = useState({ message:'', time:'12:00', imageUrl:'' });
  const [saving,     setSaving]    = useState(false);
  const [error,      setError]     = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('meta_clients').select('*').eq('user_id', user.id)
        .then(({ data }) => { setClients(data ?? []); if (data?.[0]) setSelC(data[0]); });
    });
  }, []);

  useEffect(() => {
    if (!selC) return;
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;
    fetch(`/api/schedule?clientId=${selC.id}&month=${monthStr}`)
      .then(r=>r.json()).then(d=>setPosts(Array.isArray(d)?d:[]));
  }, [selC, year, month]);

  // Calendar grid
  const firstDay  = new Date(year, month, 1).getDay();
  const daysInMon = new Date(year, month+1, 0).getDate();
  const cells     = Array.from({ length: firstDay }).fill(null).concat(Array.from({ length: daysInMon }, (_,i)=>i+1)) as (number|null)[];

  const postsByDay: Record<number, any[]> = {};
  posts.forEach(p => {
    const d = new Date(p.scheduled_at).getDate();
    if (!postsByDay[d]) postsByDay[d] = [];
    postsByDay[d].push(p);
  });

  async function addPost() {
    if (!selC || !form.message.trim() || !selDay) return;
    setSaving(true); setError('');
    const page = selC.pages.find(p => p.id === selC.selected_page_id);
    if (!page) { setError('בחר דף Facebook ב"לקוחות"'); setSaving(false); return; }

    const scheduledAt = new Date(year, month, selDay, ...form.time.split(':').map(Number) as [number, number]).toISOString();
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selC.id, pageId: page.id, message: form.message, scheduledAt, imageUrl: form.imageUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPosts(p => [...p, data]);
      setForm({ message:'', time:'12:00', imageUrl:'' });
      setShowForm(false);
    } catch (e:any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function deletePost(id: string) {
    await fetch(`/api/schedule?id=${id}`, { method: 'DELETE' });
    setPosts(p => p.filter(x => x.id !== id));
  }

  return (
    <div>
      <PageHeader eyebrow="תוכן" title="לוח תוכן" sub="תכנן ותזמן פוסטים לכל החודש" />

      {/* Client + Month nav */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {clients.map(c => (
            <button key={c.id} onClick={() => setSelC(c)}
              className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all',
                selC?.id===c.id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#1E2F42] bg-[#162030] text-[#6B8FA8]')}>
              <span>{c.emoji}</span>{c.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => { if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }}
            className="w-8 h-8 rounded-lg bg-[#162030] border border-[#1E2F42] text-[#6B8FA8] hover:text-white flex items-center justify-center">←</button>
          <div className="font-bold text-sm w-32 text-center">{MONTHS_HE[month]} {year}</div>
          <button onClick={() => { if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }}
            className="w-8 h-8 rounded-lg bg-[#162030] border border-[#1E2F42] text-[#6B8FA8] hover:text-white flex items-center justify-center">→</button>
        </div>
      </div>

      {/* Calendar */}
      <div className="bg-[#111A24] border border-[#1E2F42] rounded-xl overflow-hidden mb-4">
        {/* Header */}
        <div className="grid grid-cols-7 border-b border-[#1E2F42]">
          {DAYS_HE.map(d => (
            <div key={d} className="text-center text-xs font-bold text-[#2E4459] py-2">{d}</div>
          ))}
        </div>
        {/* Cells */}
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const dayPosts = day ? postsByDay[day] ?? [] : [];
            const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
            const isSelected = day === selDay;
            return (
              <div key={i} onClick={() => { if(day){setSelDay(day);setShowForm(true);} }}
                className={clsx('min-h-[90px] border-b border-r border-[#1E2F42] last:border-r-0 p-1.5 transition-all',
                  day ? 'cursor-pointer hover:bg-[#162030]' : 'bg-[#0C1118]',
                  isSelected && 'bg-[#0A7AFF]/08',
                )}>
                {day && (
                  <>
                    <div className={clsx('text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center mb-1',
                      isToday ? 'bg-[#0A7AFF] text-white' : 'text-[#6B8FA8]')}>
                      {day}
                    </div>
                    {dayPosts.slice(0,2).map((p,j) => (
                      <div key={j} className="text-[10px] rounded px-1 py-0.5 mb-0.5 truncate"
                        style={{ background: `${STATUS_COLORS[p.status]}20`, color: STATUS_COLORS[p.status] }}>
                        {p.message.substring(0,20)}
                      </div>
                    ))}
                    {dayPosts.length > 2 && <div className="text-[10px] text-[#2E4459]">+{dayPosts.length-2}</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add post form */}
      {showForm && selDay && (
        <Card style={{ borderColor: 'rgba(10,122,255,.3)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-bold">{selDay} {MONTHS_HE[month]} {year}</div>
            <button onClick={() => setShowForm(false)} className="text-[#2E4459] hover:text-white">✕</button>
          </div>

          {/* Existing posts for this day */}
          {(postsByDay[selDay] ?? []).length > 0 && (
            <div className="mb-3">
              {(postsByDay[selDay]).map(p => (
                <div key={p.id} className="flex items-start gap-2 p-2 bg-[#162030] rounded-lg mb-2">
                  <div className="flex-1">
                    <div className="text-xs text-[#D9E8F5] mb-1">{p.message.substring(0,80)}</div>
                    <div className="text-[10px]" style={{ color: STATUS_COLORS[p.status] }}>● {p.status} · {new Date(p.scheduled_at).toLocaleTimeString('he',{hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                  <button onClick={() => deletePost(p.id)} className="text-[#2E4459] hover:text-red-400 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}

          <Textarea label="טקסט הפוסט" value={form.message} onChange={v=>setForm(p=>({...p,message:v}))} placeholder="מה לפרסם?" rows={3} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">שעת פרסום</label>
              <input type="time" value={form.time} onChange={e=>setForm(p=>({...p,time:e.target.value}))}
                className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-[#D9E8F5] outline-none focus:border-[#0A7AFF]" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">URL תמונה (אופציונלי)</label>
              <input type="text" value={form.imageUrl} onChange={e=>setForm(p=>({...p,imageUrl:e.target.value}))}
                placeholder="https://..." className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-[#D9E8F5] outline-none focus:border-[#0A7AFF]" dir="ltr" />
            </div>
          </div>
          {error && <Alert type="red">{error}</Alert>}
          <div className="flex gap-2">
            <Btn variant="primary" loading={saving} onClick={addPost} disabled={!form.message.trim()}>📅 תזמן פוסט</Btn>
            <Btn variant="ghost" onClick={() => setShowForm(false)}>ביטול</Btn>
          </div>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mt-4">
        {[
          { l:'מתוזמנים',  v: posts.filter(p=>p.status==='scheduled').length,  c:'#0A7AFF' },
          { l:'פורסמו',    v: posts.filter(p=>p.status==='published').length,   c:'#059669' },
          { l:'נכשלו',     v: posts.filter(p=>p.status==='failed').length,      c:'#DC2626' },
          { l:'סה"כ חודש', v: posts.length,                                     c:'#6B8FA8' },
        ].map(s => (
          <div key={s.l} className="bg-[#111A24] border border-[#1E2F42] rounded-lg p-3 text-center">
            <div className="font-mono text-xl font-medium" style={{ color: s.c }}>{s.v}</div>
            <div className="text-[11px] text-[#6B8FA8] mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
