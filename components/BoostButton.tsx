'use client';
import { useState } from 'react';
import { Btn, Spinner } from '@/components/ui';

interface BoostResult {
  ok: true;
  score_id: string;
  copy: string;
  iteration: number;
  max: number;
  score: number;
  band: 'low'|'mid'|'high';
}

interface Props {
  priorScoreId: string;
  iteration:    number;
  max:          number;
  onBoosted:    (boost: BoostResult & Record<string, any>) => void;
}

export function BoostButton({ priorScoreId, iteration, max, onBoosted }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  if (iteration >= max) return null;

  async function go() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/ai/score/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prior_score_id: priorScoreId }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setErr(data.error || 'boost_failed');
      } else {
        onBoosted(data);
      }
    } catch (e: any) {
      setErr(e?.message ?? 'network_error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Btn variant="violet" size="sm" loading={loading} onClick={go}>
        ✨ שפר ציון ({iteration + 1}/{max})
      </Btn>
      {err && <span className="text-[11px] text-red-400">{err}</span>}
    </div>
  );
}
