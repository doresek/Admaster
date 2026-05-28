'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { writeActiveClientCookie } from '@/lib/active-client';

interface Client {
  id:       string;
  name:     string;
  industry: string | null;
  emoji:    string;
}

export function ClientSwitcher({ initialActive }: { initialActive: string | null }) {
  const [open,    setOpen]    = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [active,  setActive]  = useState<string | null>(initialActive);
  const [loading, setLoading] = useState(false);
  const ref = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await fetch('/api/active-client');
    const data = await res.json();
    setClients(data.clients || []);
    setActive(data.active);
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function pick(id: string | null) {
    setLoading(true); setOpen(false);
    try {
      const res = await fetch('/api/active-client', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setActive(id);
        writeActiveClientCookie(id);
        // Force a full refresh so server components re-read the cookie
        ref.refresh();
      }
    } finally { setLoading(false); }
  }

  const activeClient = clients.find(c => c.id === active);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors',
          active
            ? 'bg-[#0A7AFF]/10 border-[#0A7AFF]/30 text-[#3D9FFF] hover:bg-[#0A7AFF]/15'
            : 'bg-[#162030] border-[#1E2F42] text-[#6B8FA8] hover:border-[#2A4158]'
        )}
        title={active ? `לקוח פעיל: ${activeClient?.name}` : 'בחר לקוח פעיל'}
      >
        <span className="text-sm">{activeClient?.emoji ?? '👤'}</span>
        <span className="text-xs font-bold max-w-[120px] truncate">
          {activeClient ? activeClient.name : 'ללא לקוח'}
        </span>
        <span className="text-[9px] opacity-70">▾</span>
      </button>

      {open && (
        <div className="absolute top-full mt-2 end-0 w-[280px] bg-[#111A24] border border-[#1E2F42] rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#1E2F42] bg-gradient-to-r from-[#0A7AFF]/10 to-[#6D28D9]/5">
            <div className="font-bold text-sm text-[#D9E8F5]">לקוח פעיל</div>
            <div className="text-[11px] text-[#6B8FA8] mt-0.5">
              כל יצירת תוכן תשתמש בבריף ובBrand DNA של הלקוח הנבחר
            </div>
          </div>

          <button
            onClick={() => pick(null)}
            className={clsx(
              'w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors text-start border-b border-[#1E2F42]',
              !active
                ? 'bg-[#0A7AFF]/12 text-[#3D9FFF] font-bold'
                : 'text-[#6B8FA8] hover:bg-[#162030] hover:text-[#D9E8F5]'
            )}
          >
            <span>—</span>
            <span>ללא לקוח (Brand DNA בלבד)</span>
          </button>

          <div className="max-h-[320px] overflow-y-auto">
            {clients.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-[#2E4459]">
                אין לקוחות שמורים<br/>
                <a href="/clients" className="text-[#3D9FFF] hover:underline">+ הוסף לקוח ראשון</a>
              </div>
            )}
            {clients.map(c => (
              <button
                key={c.id}
                onClick={() => pick(c.id)}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-start',
                  c.id === active
                    ? 'bg-[#0A7AFF]/12 text-[#3D9FFF] font-bold'
                    : 'text-[#D9E8F5] hover:bg-[#162030]'
                )}
              >
                <span className="text-lg flex-shrink-0">{c.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{c.name}</div>
                  {c.industry && <div className="text-[10px] text-[#6B8FA8] truncate">{c.industry}</div>}
                </div>
                {c.id === active && <span className="text-[#3D9FFF]">✓</span>}
              </button>
            ))}
          </div>

          <div className="px-4 py-2 border-t border-[#1E2F42] text-center">
            <a href="/clients" className="text-[11px] text-[#6B8FA8] hover:text-[#3D9FFF]">ניהול לקוחות →</a>
          </div>
        </div>
      )}
    </div>
  );
}
