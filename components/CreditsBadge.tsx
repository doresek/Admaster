'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { PLAN_CONFIG, type Plan } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface Props {
  initialCredits: number;
  initialPlan: Plan;
}

export function CreditsBadge({ initialCredits, initialPlan }: Props) {
  const { data } = useSWR<{ credits: number; plan: Plan }>('/api/credits', fetcher, {
    fallbackData: { credits: initialCredits, plan: initialPlan },
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  const credits = data?.credits ?? initialCredits;
  const plan    = data?.plan    ?? initialPlan;
  const cfg     = PLAN_CONFIG[plan];
  const low     = credits < 20;

  return (
    <Link
      href="/credits"
      title={`${credits.toLocaleString()} קרדיטים · תוכנית ${cfg.name}`}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#152138] border border-[#243752] hover:border-[#324C6B] transition-colors group"
    >
      <span className={low ? 'text-[#D97706]' : 'text-[#3D9FFF]'}>⚡</span>
      <span className="font-mono text-sm font-semibold text-[#D9E8F5] tabular-nums">
        {credits.toLocaleString()}
      </span>
      <span
        className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
        style={{ background: `${cfg.color}22`, color: cfg.color, border: `1px solid ${cfg.color}44` }}
      >
        {cfg.name}
      </span>
    </Link>
  );
}
