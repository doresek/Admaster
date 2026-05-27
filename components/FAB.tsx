'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';

interface Action {
  emoji: string;
  label: string;
  href:  string;
  cost?: number;
  badge?: string;
}

const ACTIONS: Action[] = [
  { emoji: '🚀', label: 'קמפיין בלחיצה',    href: '/quick-campaign', cost: 15, badge: 'מומלץ' },
  { emoji: '✨', label: 'צור פוסט',          href: '/create',         cost: 3  },
  { emoji: '🎨', label: 'צור תמונה',         href: '/images',         cost: 5  },
  { emoji: '📄', label: 'דף נחיתה',          href: '/landing-pages'           },
  { emoji: '📧', label: 'הודעה (Email/SMS)', href: '/messages',       cost: 3  },
  { emoji: '🧬', label: 'אווטאר לקוח',       href: '/briefs',         cost: 10 },
  { emoji: '💎', label: 'הצעה (Offer Stack)', href: '/offer-stack',    cost: 6  },
  { emoji: '🧠', label: 'נתח בריף',          href: '/analyze-brief',  cost: 2  },
  { emoji: '🩺', label: 'נתח מודעה חלשה',    href: '/analyze-weak',   cost: 3  },
  { emoji: '🧪', label: 'The Lab (חינם)',    href: '/lab'                     },
];

export function FAB() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} className="fixed bottom-6 start-6 z-50">
      {/* Menu */}
      {open && (
        <div className="absolute bottom-full mb-3 start-0 bg-[#152138] border border-[#243752] rounded-2xl shadow-2xl overflow-hidden w-[260px] animate-[fadeUp_.2s_ease]">
          <div className="px-4 py-3 border-b border-[#243752] bg-gradient-to-r from-[#0A7AFF]/15 to-[#6D28D9]/10">
            <div className="font-bold text-sm text-[#D9E8F5]">⚡ פעולות מהירות</div>
            <div className="text-[10px] text-[#6B8FA8] mt-0.5">בחר פעולה ליצירה מיידית</div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {ACTIONS.map(a => (
              <Link key={a.href} href={a.href} onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#1A2A42] transition-colors border-b border-[#243752] last:border-0">
                <span className="text-lg flex-shrink-0">{a.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[#D9E8F5] font-medium">{a.label}</div>
                </div>
                {a.badge && (
                  <span className="text-[9px] font-bold bg-[#0A7AFF] text-white px-1.5 py-0.5 rounded-full">{a.badge}</span>
                )}
                {a.cost !== undefined && !a.badge && (
                  <span className="text-[10px] bg-[#22334D] text-[#6B8FA8] px-1.5 py-0.5 rounded-full font-mono">{a.cost}⚡</span>
                )}
                {!a.cost && !a.badge && (
                  <span className="text-[10px] bg-[#059669]/15 text-[#34D399] px-1.5 py-0.5 rounded-full font-bold">חינם</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* FAB */}
      <button onClick={() => setOpen(o => !o)}
        className={clsx(
          'w-14 h-14 rounded-full bg-gradient-to-br from-[#0A7AFF] to-[#6D28D9] text-white shadow-[0_8px_28px_rgba(10,122,255,0.45)] flex items-center justify-center text-2xl hover:scale-105 transition-all',
          open && 'rotate-45'
        )}
        title="יצירת AI">
        {open ? '✕' : '✨'}
      </button>
    </div>
  );
}
