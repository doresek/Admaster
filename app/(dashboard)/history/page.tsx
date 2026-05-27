'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Input, Btn, Alert, PageHeader, Chip, CopyBtn } from '@/components/ui';
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

const TYPE_LABEL: Record<string, { label: string; emoji: string; restoreHref: (id: string) => string }> = {
  post:       { label: 'פוסט',         emoji: '✨', restoreHref: () => '/create' },
  analyze:    { label: 'ניתוח מודעה',   emoji: '🔬', restoreHref: () => '/analyze' },
  variations: { label: 'וריאציות',      emoji: '🔀', restoreHref: () => '/variations' },
  holiday:    { label: 'פוסט חג',       emoji: '📅', restoreHref: () => '/calendar' },
  campaign:   { label: 'קמפיין',        emoji: '🚀', restoreHref: () => '/quick-campaign' },
  avatar:     { label: 'אווטאר',        emoji: '🧬', restoreHref: () => '/briefs' },
  ads_avatar: { label: 'מודעות מאווטאר', emoji: '✍️', restoreHref: () => '/briefs' },
  funnel:     { label: 'משפך',           emoji: '🔮', restoreHref: () => '/briefs' },
  lab:        { label: 'The Lab',       emoji: '🧪', restoreHref: () => '/lab' },
  email:      { label: 'אימייל',        emoji: '📧', restoreHref: () => '/messages' },
  sms:        { label: 'SMS',           emoji: '📱', restoreHref: () => '/messages' },
  refined:    { label: 'גרסה משופרת',   emoji: '🔁', restoreHref: () => '/refine' },
};

export default function HistoryPage() {
  const [items,   setItems]   = useState<Item[]>([]);
  const [clients, setClients] = useState<MetaClient[]>([]);
  const [q,       setQ]       = useState('');
  const [typeF,   setTypeF]   = useState<string>('all');
  const [clientF, setClientF] = useState<string>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      Promise.all([
        supabase.from('generated_content')
          .select('id, type, platform, client_id, input, output, favorite, tags, folder, title, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('meta_clients').select('*').eq('user_id', user.id),
      ]).then(([cRes, clRes]) => {
        setItems(cRes.data ?? []);
        setClients(clRes.data ?? []);
        setLoading(false);
      });
    });
  }, []);

  const filtered = useMemo(() => {
    return items.filter(it => {
      if (favOnly && !it.favorite) return false;
      if (typeF !== 'all' && it.type !== typeF) return false;
      if (clientF !== 'all' && it.client_id !== clientF) return false;
      if (q.trim()) {
        const hay = JSON.stringify({ t: it.title, i: it.input, o: it.output }).toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [items, q, typeF, clientF, favOnly]);

  async function toggleFavorite(id: string) {
    const cur = items.find(i => i.id === id);
    if (!cur) return;
    const next = !cur.favorite;
    setItems(p => p.map(i => i.id === id ? { ...i, favorite: next } : i));
    await supabase.from('generated_content').update({ favorite: next }).eq('id', id);
  }

  async function restore(item: Item) {
    setRestoring(item.id);
    // Stash the item in sessionStorage and navigate
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('restore_item', JSON.stringify(item));
    }
    const target = TYPE_LABEL[item.type]?.restoreHref(item.id) ?? '/';
    window.location.href = target;
  }

  function exportCSV() {
    const headers = ['date','type','platform','title','input','output'];
    const rows = filtered.map(it => [
      new Date(it.created_at).toLocaleString('he'),
      it.type,
      it.platform ?? '',
      it.title ?? '',
      JSON.stringify(it.input ?? {}),
      JSON.stringify(it.output ?? {}),
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `history-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const types = Object.entries(TYPE_LABEL).filter(([k]) => items.some(i => i.type === k));

  return (
    <div>
      <PageHeader
        eyebrow="History"
        title="🕒 היסטוריית יצירות"
        sub={`${filtered.length} מתוך ${items.length} פריטים`}
        right={<Btn variant="ghost" size="sm" onClick={exportCSV} disabled={filtered.length === 0}>📥 CSV</Btn>}
      />

      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <CardLabel>חיפוש</CardLabel>
            <Input value={q} onChange={setQ} placeholder="חיפוש בכותרת, בריף או תוצאה..." />
          </div>
          <div>
            <CardLabel>סוג</CardLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip label="הכל" active={typeF==='all'} onClick={() => setTypeF('all')} />
              {types.map(([k, v]) => (
                <Chip key={k} label={`${v.emoji} ${v.label}`} active={typeF===k} onClick={() => setTypeF(k)} />
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
        <div className="flex items-center gap-2 pt-2 border-t border-[#243752]">
          <Chip label={favOnly ? '⭐ מועדפים בלבד' : '☆ הצג גם לא-מועדפים'} active={favOnly} onClick={() => setFavOnly(v => !v)} />
        </div>
      </Card>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
          <div className="text-4xl mb-3 opacity-30">🕒</div>
          <div className="text-sm">אין פריטים שתואמים את הסינון</div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(item => {
          const meta = TYPE_LABEL[item.type] ?? { label: item.type, emoji: '📄', restoreHref: () => '/' };
          const client = clients.find(c => c.id === item.client_id);
          const preview = item.output?.text || item.output?.post || item.output?.body || JSON.stringify(item.output ?? {}).substring(0, 200);
          return (
            <div key={item.id} className="bg-[#152138] border border-[#243752] rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-lg">{meta.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-bold text-[#D9E8F5]">{meta.label}</span>
                      {item.platform && <span className="text-[10px] text-[#6B8FA8]">· {item.platform}</span>}
                      {client && <span className="text-[10px] text-[#6B8FA8]">· {client.emoji} {client.name}</span>}
                    </div>
                    <div className="text-[10px] text-[#2E4459]">{new Date(item.created_at).toLocaleString('he')}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => toggleFavorite(item.id)} title="מועדף"
                    className="text-base hover:scale-110 transition-transform">
                    {item.favorite ? '⭐' : '☆'}
                  </button>
                </div>
              </div>

              <div className="text-[12.5px] text-[#6B8FA8] leading-relaxed line-clamp-3 mb-3 whitespace-pre-wrap">
                {preview}
              </div>

              <div className="flex items-center gap-2">
                <Btn variant="ghost" size="xs" onClick={() => restore(item)} loading={restoring === item.id}>
                  ↻ שחזר
                </Btn>
                <CopyBtn text={preview} label="📋" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
