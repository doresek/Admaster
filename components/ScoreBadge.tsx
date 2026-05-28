'use client';
import { clsx } from 'clsx';
import type { ScoreBand } from '@/lib/scoring';

const BAND_STYLES: Record<ScoreBand, string> = {
  low:  'bg-red-900/25 text-red-300 border-red-500/40',
  mid:  'bg-amber-900/25 text-amber-300 border-amber-500/40',
  high: 'bg-emerald-900/25 text-emerald-300 border-emerald-500/40',
};

interface Props {
  score:   number;
  band:    ScoreBand;
  onClick?: () => void;
  className?: string;
}

export function ScoreBadge({ score, band, onClick, className }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`ציון חיזוי ביצועים: ${score}/100`}
      className={clsx(
        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all hover:brightness-110',
        BAND_STYLES[band],
        className
      )}
    >
      <span className="text-base leading-none">{score}</span>
      <span className="opacity-60 text-[10px]">/100</span>
    </button>
  );
}
