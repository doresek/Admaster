'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';

interface Rec {
  kind:         'quick_win' | 'growth' | 'retention' | 'warning' | 'tip';
  title:        string;
  body:         string;
  action_href:  string;
  action_label: string;
  priority:     number;
}

const KIND_STYLE: Record<string, { color: string; bg: string; border: string; emoji: string }> = {
  quick_win:  { color:'#34D399', bg:'rgba(5,150,105,.08)',  border:'rgba(5,150,105,.3)',  emoji:'⚡' },
  growth:     { color:'#3D9FFF', bg:'rgba(10,122,255,.08)', border:'rgba(10,122,255,.3)', emoji:'📈' },
  retention:  { color:'#A78BFA', bg:'rgba(109,40,217,.08)', border:'rgba(109,40,217,.3)', emoji:'🔁' },
  warning:    { color:'#D97706', bg:'rgba(217,119,6,.08)',  border:'rgba(217,119,6,.3)',  emoji:'⚠️' },
  tip:        { color:'#6B8FA8', bg:'rgba(107,143,168,.06)',border:'rgba(107,143,168,.25)',emoji:'💡' },
};

export function RecommendationsWidget() {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/recommendations');
      const data = await res.json();
      setRecs(Array.isArray(data) ? data : []);
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function dismiss(r: Rec) {
    setRecs(p => p.filter(x => x.title !== r.title));
    await fetch('/api/recommendations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: r.title, kind: r.kind }),
    });
  }

  if (loading) return null;
  if (recs.length === 0) return null;

  return (
    <div className="bg-[#152138] border border-[#243752] rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest flex items-center gap-1.5">
          <div className="w-0.5 h-3 bg-[#D4AF55] rounded-full" />
          🤖 המלצות AI עבורך
        </div>
        <span className="text-[10px] text-[#6B8FA8]">{recs.length} פעולות מומלצות</span>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
        {recs.map(r => {
          const s = KIND_STYLE[r.kind] ?? KIND_STYLE.tip;
          return (
            <div key={r.title}
              className="relative rounded-xl p-3 border"
              style={{ background: s.bg, borderColor: s.border }}>
              <button onClick={() => dismiss(r)} title="הסר המלצה"
                className="absolute top-2 end-2 w-5 h-5 text-[10px] text-[#2E4459] hover:text-red-400 transition-colors">
                ✕
              </button>
              <div className="flex items-start gap-2 mb-2 pe-5">
                <span className="text-lg flex-shrink-0">{s.emoji}</span>
                <div className="font-semibold text-[12.5px] text-[#D9E8F5] leading-tight">{r.title}</div>
              </div>
              <div className="text-[11.5px] text-[#6B8FA8] leading-relaxed mb-3">{r.body}</div>
              <Link href={r.action_href}
                className="inline-flex items-center gap-1 text-[11px] font-bold transition-colors"
                style={{ color: s.color }}>
                {r.action_label} →
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
