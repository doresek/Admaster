'use client';
import { useState } from 'react';

// Unobtrusive Hebrew learning-signal control: "✓ עבד / ✗ לא נכון".
// POSTs to /api/intelligence/signal which feeds the lifecycle engine — a "worked"
// corroborates the insights the artifact was grounded on; "wrong" weakens/refutes
// them. Pass an artifactId (artifact-level signal) or an insightId (insight-level).
export function SignalButtons({
  artifactId,
  insightId,
  className,
}: {
  artifactId?: string | null;
  insightId?:  string | null;
  className?:  string;
}) {
  const [sent, setSent]       = useState<'worked' | 'wrong' | null>(null);
  const [loading, setLoading] = useState<'worked' | 'wrong' | null>(null);
  const [error, setError]     = useState(false);

  const target = artifactId ?? insightId;
  if (!target) return null;

  async function send(kind: 'worked' | 'wrong') {
    if (sent || loading) return;
    setLoading(kind); setError(false);
    try {
      const res = await fetch('/api/intelligence/signal', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactId: artifactId ?? undefined,
          insightId:  insightId ?? undefined,
          kind,
        }),
      });
      if (!res.ok) throw new Error('signal failed');
      setSent(kind);
    } catch {
      setError(true);
    } finally {
      setLoading(null);
    }
  }

  if (sent) {
    return (
      <div className={`text-[11px] text-emerald-400 ${className ?? ''}`} dir="rtl">
        {sent === 'worked' ? '✓ תודה — נלמד שזה עבד' : '✗ תודה — נעדכן את המודל'}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`} dir="rtl">
      <span className="text-[11px] text-[#6B8FA8]">עזרה למודל ללמוד:</span>
      <button
        type="button"
        onClick={() => send('worked')}
        disabled={!!loading}
        className="text-[11px] font-semibold rounded-full px-2.5 py-0.5 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
      >
        {loading === 'worked' ? '…' : '✓ עבד'}
      </button>
      <button
        type="button"
        onClick={() => send('wrong')}
        disabled={!!loading}
        className="text-[11px] font-semibold rounded-full px-2.5 py-0.5 border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50 transition-colors"
      >
        {loading === 'wrong' ? '…' : '✗ לא נכון'}
      </button>
      {error && <span className="text-[11px] text-rose-400">שגיאה — נסה שוב</span>}
    </div>
  );
}
