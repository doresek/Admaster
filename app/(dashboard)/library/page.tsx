'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Input, Btn, PageHeader, Chip, CopyBtn } from '@/components/ui';
import type { MetaClient } from '@/types';
import { clsx } from 'clsx';

interface Item {
  id:         string;
  type:       string;
  platform:   string | null;
  client_id:  string | null;
  input:      any;
  output:     any;
  favorite:   boolean | null;
  tags:       string[] | null;
  folder:     string | null;
  title:      string | null;
  created_at: string;
}

export default function LibraryPage() {
  const [items,   setItems]   = useState<Item[]>([]);
  const [clients, setClients] = useState<MetaClient[]>([]);
  const [q,       setQ]       = useState('');
  const [folder,  setFolder]  = useState<string>('all');
  const [tag,     setTag]     = useState<string>('all');
  const [clientF, setClientF] = useState<string>('all');
  const [view,    setView]    = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Item | null>(null);
  const supabase = createClient();

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [contentRes, clientsRes] = await Promise.all([
      supabase.from('generated_content')
        .select('id, type, platform, client_id, input, output, favorite, tags, folder, title, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('meta_clients').select('*').eq('user_id', user.id),
    ]);
    setItems(contentRes.data ?? []);
    setClients(clientsRes.data ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const allFolders = useMemo(() => Array.from(new Set(items.map(i => i.folder).filter(Boolean) as string[])), [items]);
  const allTags    = useMemo(() => Array.from(new Set(items.flatMap(i => i.tags ?? []))), [items]);

  const filtered = useMemo(() => {
    return items.filter(it => {
      if (folder !== 'all' && it.folder !== folder) return false;
      if (tag !== 'all' && !(it.tags ?? []).includes(tag)) return false;
      if (clientF !== 'all' && it.client_id !== clientF) return false;
      if (q.trim()) {
        const hay = JSON.stringify({ t: it.title, tags: it.tags, i: it.input, o: it.output }).toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [items, q, folder, tag, clientF]);

  async function toggleFavorite(id: string) {
    const cur = items.find(i => i.id === id);
    if (!cur) return;
    const next = !cur.favorite;
    setItems(p => p.map(i => i.id === id ? { ...i, favorite: next } : i));
    await fetch(`/api/library?id=${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: next }) });
  }

  async function remove(id: string) {
    if (!confirm('למחוק?')) return;
    setItems(p => p.filter(i => i.id !== id));
    await fetch(`/api/library?id=${id}`, { method: 'DELETE' });
  }

  async function saveEdit() {
    if (!editing) return;
    await fetch(`/api/library?id=${editing.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editing.title, tags: editing.tags ?? [], folder: editing.folder, client_id: editing.client_id }),
    });
    setItems(p => p.map(i => i.id === editing.id ? editing : i));
    setEditing(null);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Ad Library"
        title="📚 ספריית מודעות"
        sub={`${filtered.length} מתוך ${items.length} פריטים · ${items.filter(i=>i.favorite).length} מועדפים`}
        right={
          <div className="flex gap-1.5">
            <Btn variant={view==='grid'?'primary':'ghost'} size="xs" onClick={() => setView('grid')}>▦</Btn>
            <Btn variant={view==='list'?'primary':'ghost'} size="xs" onClick={() => setView('list')}>≡</Btn>
          </div>
        }
      />

      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <CardLabel>חיפוש</CardLabel>
            <Input value={q} onChange={setQ} placeholder="כל תוכן..." />
          </div>
          <div>
            <CardLabel>תיקייה</CardLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip label="הכל" active={folder==='all'} onClick={() => setFolder('all')} />
              {allFolders.map(f => (
                <Chip key={f} label={`📁 ${f}`} active={folder===f} onClick={() => setFolder(f)} />
              ))}
            </div>
          </div>
          <div>
            <CardLabel>תגית</CardLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip label="הכל" active={tag==='all'} onClick={() => setTag('all')} />
              {allTags.slice(0, 8).map(t => (
                <Chip key={t} label={`#${t}`} active={tag===t} onClick={() => setTag(t)} />
              ))}
            </div>
          </div>
          <div>
            <CardLabel>לקוח</CardLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip label="הכל" active={clientF==='all'} onClick={() => setClientF('all')} />
              {clients.map(c => (
                <Chip key={c.id} label={`${c.emoji} ${c.name}`} active={clientF===c.id} onClick={() => setClientF(c.id)} />
              ))}
            </div>
          </div>
        </div>
      </Card>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
          <div className="text-4xl mb-3 opacity-30">📚</div>
          <div className="text-sm">אין פריטים</div>
        </div>
      )}

      <div className={view === 'grid' ? 'grid md:grid-cols-3 gap-3' : 'space-y-2'}>
        {filtered.map(it => {
          const client = clients.find(c => c.id === it.client_id);
          const preview = it.output?.text || it.output?.post || it.output?.body || '';
          return (
            <div key={it.id} className="bg-[#152138] border border-[#243752] rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <button onClick={() => toggleFavorite(it.id)} className="text-base">{it.favorite ? '⭐' : '☆'}</button>
                    <span className="text-[10px] font-bold text-[#3D9FFF] uppercase">{it.type}</span>
                    {it.platform && <span className="text-[10px] text-[#6B8FA8]">· {it.platform}</span>}
                  </div>
                  {it.title && <div className="font-semibold text-sm text-[#D9E8F5] mb-1 truncate">{it.title}</div>}
                  {client && <div className="text-[10px] text-[#6B8FA8] mb-1">{client.emoji} {client.name}</div>}
                </div>
              </div>

              <div className={clsx('text-[12.5px] text-[#6B8FA8] leading-relaxed whitespace-pre-wrap mb-2',
                view === 'grid' ? 'line-clamp-5' : 'line-clamp-3')}>{preview}</div>

              {(it.tags && it.tags.length > 0) && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {it.tags.map(t => (
                    <span key={t} className="text-[10px] bg-[#22334D] text-[#6B8FA8] px-1.5 py-0.5 rounded">#{t}</span>
                  ))}
                </div>
              )}
              {it.folder && <div className="text-[10px] text-[#D4AF55] mb-2">📁 {it.folder}</div>}

              <div className="flex items-center justify-between pt-2 border-t border-[#243752]">
                <div className="text-[10px] text-[#2E4459]">{new Date(it.created_at).toLocaleDateString('he')}</div>
                <div className="flex items-center gap-1">
                  <Btn variant="ghost" size="xs" onClick={() => setEditing(it)}>✏️</Btn>
                  <CopyBtn text={preview} label="📋" />
                  <button onClick={() => remove(it.id)} className="text-[10px] text-[#2E4459] hover:text-red-400 px-1">✕</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#152138] border border-[#243752] rounded-2xl max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="font-bold text-base text-[#D9E8F5]">עריכת פריט</div>
              <button onClick={() => setEditing(null)} className="text-[#2E4459] hover:text-white">✕</button>
            </div>
            <Input label="כותרת" value={editing.title ?? ''} onChange={v => setEditing(e => e ? { ...e, title: v } : e)} placeholder="כותרת לשליפה מהירה" />
            <Input label="תיקייה" value={editing.folder ?? ''} onChange={v => setEditing(e => e ? { ...e, folder: v } : e)} placeholder="לדוגמה: קמפיין חורף 2026" />
            <Input
              label="תגיות (מופרדות בפסיק)"
              value={(editing.tags ?? []).join(', ')}
              onChange={v => setEditing(e => e ? { ...e, tags: v.split(',').map(s => s.trim()).filter(Boolean) } : e)}
              placeholder="אימייל, פרומו, מבצע"
            />
            <div className="mb-3">
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">לקוח</label>
              <select value={editing.client_id ?? ''} onChange={e => setEditing(p => p ? { ...p, client_id: e.target.value || null } : p)}
                className="w-full bg-[#1A2A42] border border-[#243752] rounded-lg px-3 py-2.5 text-sm text-[#D9E8F5] outline-none" dir="rtl">
                <option value="">ללא</option>
                {clients.map(c => <option key={c.id} value={c.id} className="bg-[#1A2A42]">{c.emoji} {c.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <Btn variant="primary" full onClick={saveEdit}>💾 שמור</Btn>
              <Btn variant="ghost" onClick={() => setEditing(null)}>ביטול</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
