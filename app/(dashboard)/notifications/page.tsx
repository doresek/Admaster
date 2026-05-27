'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, Btn, Card } from '@/components/ui';
import { clsx } from 'clsx';

interface Notif {
  id:         string;
  type:       string;
  title:      string;
  body:       string | null;
  href:       string | null;
  read:       boolean;
  created_at: string;
}

const TYPE_ICON: Record<string, string> = {
  approval_response: '✅',
  lead_submission:   '📋',
  series_progress:   '🗓',
  credits_low:       '⚠️',
  billing:           '💳',
  support_reply:     '🎫',
  recommendation:    '💡',
  system:            '🔔',
};

export default function NotificationsPage() {
  const [items, setItems] = useState<Notif[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  async function load() {
    const res = await fetch('/api/notifications');
    const data = await res.json();
    setItems(data.items ?? []);
  }
  useEffect(() => { load(); }, []);

  async function markOne(id: string) {
    await fetch(`/api/notifications?id=${id}`, { method: 'PATCH' });
    setItems(p => p.map(n => n.id === id ? { ...n, read: true } : n));
  }
  async function remove(id: string) {
    await fetch(`/api/notifications?id=${id}`, { method: 'DELETE' });
    setItems(p => p.filter(n => n.id !== id));
  }
  async function markAll() {
    await fetch('/api/notifications?all=true', { method: 'PATCH' });
    setItems(p => p.map(n => ({ ...n, read: true })));
  }

  const filtered = filter === 'unread' ? items.filter(n => !n.read) : items;
  const unread   = items.filter(n => !n.read).length;

  return (
    <div>
      <PageHeader
        eyebrow="התראות"
        title="🔔 כל ההתראות"
        sub={`${unread} לא נקראו · ${items.length} סך הכל`}
        right={
          <div className="flex gap-2">
            <Btn variant={filter==='all'?'primary':'ghost'} size="sm" onClick={() => setFilter('all')}>הכל</Btn>
            <Btn variant={filter==='unread'?'primary':'ghost'} size="sm" onClick={() => setFilter('unread')}>לא נקראו ({unread})</Btn>
            {unread > 0 && <Btn variant="ghost" size="sm" onClick={markAll}>סמן הכל כנקרא</Btn>}
          </div>
        }
      />

      {filtered.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
          <div className="text-5xl mb-3 opacity-30">🔔</div>
          <div className="text-base font-semibold">{filter==='unread' ? 'כל ההתראות נקראו' : 'אין התראות'}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(n => {
            const inner = (
              <div className={clsx('flex items-start gap-3 p-4 border rounded-xl transition-all',
                !n.read ? 'bg-[#0A7AFF]/5 border-[#0A7AFF]/30 hover:bg-[#0A7AFF]/10' : 'bg-[#111A24] border-[#1E2F42] hover:border-[#2A4158]')}>
                <span className="text-2xl flex-shrink-0">{TYPE_ICON[n.type] ?? '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={clsx('font-semibold text-sm', !n.read ? 'text-[#D9E8F5]' : 'text-[#6B8FA8]')}>{n.title}</span>
                    {!n.read && <span className="w-1.5 h-1.5 bg-[#3D9FFF] rounded-full" />}
                  </div>
                  {n.body && <div className="text-[12.5px] text-[#6B8FA8] leading-relaxed">{n.body}</div>}
                  <div className="text-[11px] text-[#2E4459] mt-1.5">{new Date(n.created_at).toLocaleString('he')}</div>
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  {!n.read && <button onClick={(e) => { e.preventDefault(); markOne(n.id); }} className="text-[10px] text-[#3D9FFF] hover:underline">סמן כנקרא</button>}
                  <button onClick={(e) => { e.preventDefault(); remove(n.id); }} className="text-[10px] text-[#2E4459] hover:text-red-400">✕ מחק</button>
                </div>
              </div>
            );
            return n.href
              ? <Link key={n.id} href={n.href} onClick={() => !n.read && markOne(n.id)}>{inner}</Link>
              : <div key={n.id}>{inner}</div>;
          })}
        </div>
      )}
    </div>
  );
}
