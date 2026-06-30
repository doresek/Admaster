import type { ClientInsight, InsightLayer } from '@/lib/intelligence/types';
import { InsightCard } from './InsightCard';

// The centerpiece: three columns of living-knowledge atoms — העסק / הלקוחות /
// הגשר — each sorted by confidence desc. Pure presentational shell; each card
// owns its own signal loop.
const COLUMNS: { layer: InsightLayer; title: string; hint: string }[] = [
  { layer: 'business',  title: '🏢 העסק',    hint: 'מה האמת על העסק וההצעה' },
  { layer: 'customers', title: '👥 הלקוחות', hint: 'מה מניע את הקהל' },
  { layer: 'bridge',    title: '🌉 הגשר',    hint: 'איך מחברים ביניהם' },
];

export function KnowledgeWall({ insights }: { insights: ClientInsight[] }) {
  return (
    <div dir="rtl" className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {COLUMNS.map((col) => {
        const cards = insights
          .filter((i) => i.layer === col.layer)
          .sort((a, b) => b.confidence - a.confidence);
        return (
          <div key={col.layer} className="min-w-0">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <div className="text-sm font-bold text-[#D9E8F5]">{col.title}</div>
                <div className="text-[10px] text-[#6B8FA8]">{col.hint}</div>
              </div>
              <span className="text-[11px] font-mono text-[#6B8FA8] bg-[#162030] border border-[#1E2F42] rounded-full px-2 py-0.5">
                {cards.length}
              </span>
            </div>
            <div className="space-y-3">
              {cards.length > 0 ? (
                cards.map((c) => <InsightCard key={c.id} insight={c} />)
              ) : (
                <div className="rounded-xl border border-dashed border-[#1E2F42] p-4 text-center text-[11px] text-[#2E4459]">
                  אין תובנות עדיין בשכבה זו
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
