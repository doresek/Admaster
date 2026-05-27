'use client';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
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

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch('/api/notifications');
      const data = await res.json();
      setItems(data.items ?? []);
      setUnread(data.unread ?? 0);
    } catch {}
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // poll every minute
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function markOne(id: string) {
    await fetch(`/api/notifications?id=${id}`, { method: 'PATCH' });
    setItems(p => p.map(n => n.id === id ? { ...n, read: true } : n));
    setUnread(n => Math.max(0, n - 1));
  }

  async function markAll() {
    await fetch('/api/notifications?all=true', { method: 'PATCH' });
    setItems(p => p.map(n => ({ ...n, read: true })));
    setUnread(0);
  }

  const display = unread > 99 ? '99+' : unread > 9 ? `${unread}+` : unread > 0 ? String(unread) : '';

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="relative w-9 h-9 rounded-lg bg-[#1A2A42] border border-[#243752] hover:border-[#324C6B] flex items-center justify-center text-[15px] transition-colors">
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-[#DC2626] text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 border-2 border-[#0B1424]">
            {display}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-2 end-0 w-[360px] bg-[#152138] border border-[#243752] rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#243752]">
            <div className="font-bold text-sm text-[#D9E8F5]">התראות {unread > 0 && <span className="text-[#3D9FFF]">({unread})</span>}</div>
            {unread > 0 && (
              <button onClick={markAll} className="text-[11px] text-[#3D9FFF] hover:underline">סמן הכל כנקרא</button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="text-center py-12 text-xs text-[#2E4459]">אין התראות חדשות</div>
            ) : items.map(n => (
              <Link key={n.id} href={n.href ?? '#'}
                onClick={() => { if (!n.read) markOne(n.id); if (!n.href) return false; setOpen(false); }}
                className={clsx('flex items-start gap-3 px-4 py-3 border-b border-[#243752] last:border-0 hover:bg-[#1A2A42] transition-colors',
                  !n.read && 'bg-[#0A7AFF]/5')}>
                <span className="text-base flex-shrink-0">{TYPE_ICON[n.type] ?? '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={clsx('text-[12.5px] font-semibold', !n.read ? 'text-[#D9E8F5]' : 'text-[#6B8FA8]')}>{n.title}</span>
                    {!n.read && <span className="w-1.5 h-1.5 bg-[#3D9FFF] rounded-full" />}
                  </div>
                  {n.body && <div className="text-[11px] text-[#6B8FA8] leading-relaxed line-clamp-2">{n.body}</div>}
                  <div className="text-[10px] text-[#2E4459] mt-1">{new Date(n.created_at).toLocaleString('he', { hour:'2-digit', minute:'2-digit', day:'numeric', month:'numeric' })}</div>
                </div>
              </Link>
            ))}
          </div>

          {items.length > 0 && (
            <div className="px-4 py-2 border-t border-[#243752] text-center">
              <Link href="/notifications" onClick={() => setOpen(false)} className="text-[11px] text-[#3D9FFF] hover:underline">
                כל ההתראות →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
