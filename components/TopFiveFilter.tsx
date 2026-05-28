'use client';
import { clsx } from 'clsx';

interface Props {
  active: boolean;
  onToggle: () => void;
  hidden: number;
}

export function TopFiveFilter({ active, onToggle, hidden }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
        active
          ? 'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]'
          : 'border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158] hover:text-[#D9E8F5]',
      )}
    >
      <span>{active ? '🏆 רק 5 המובילות' : 'הצג רק 5 מובילות'}</span>
      {active && hidden > 0 && (
        <span className="text-[10px] opacity-70">({hidden} מוסתרות)</span>
      )}
    </button>
  );
}
