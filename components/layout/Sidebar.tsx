'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { clsx } from 'clsx';
import type { Plan } from '@/types';
import { PLAN_CONFIG } from '@/types';

const NAV = [
  { id:'dash',       href:'/',            icon:'⚡', label:'לוח בקרה' },
  { id:'brand',      href:'/brand',       icon:'🧬', label:'Brand DNA' },
  { sec:'📊 ניתוח' },
  { id:'analytics',  href:'/analytics',   icon:'📈', label:'ביצועים Meta',  badge:'חדש' },
  { id:'competitor', href:'/competitor',  icon:'🔍', label:'מחקר מתחרים',  badge:'חדש' },
  { id:'reports',    href:'/reports',     icon:'📋', label:'דוחות',         badge:'חדש' },
  { sec:'✨ יצירה' },
  { id:'create',     href:'/create',      icon:'✨', label:'צור פוסט',     cost:3 },
  { id:'images',     href:'/images',      icon:'🎨', label:'מחולל תמונות', cost:5, badge:'חדש' },
  { id:'analyze',    href:'/analyze',     icon:'🔬', label:'נתח מודעה',    cost:5 },
  { id:'variations', href:'/variations',  icon:'🔀', label:'וריאציות',     cost:8 },
  { id:'calendar',   href:'/calendar',    icon:'📅', label:'לוח חגים',     cost:3 },
  { sec:'📅 תוכן' },
  { id:'schedule',   href:'/schedule',    icon:'🗓', label:'לוח תוכן',     badge:'חדש' },
  { sec:'🔌 Meta' },
  { id:'clients',    href:'/clients',     icon:'👥', label:'לקוחות' },
  { id:'briefs',     href:'/briefs',      icon:'📝', label:'בריפים' },
  { id:'publish',    href:'/publish',     icon:'📤', label:'פרסם',          cost:2 },
  { id:'campaign',   href:'/campaign',    icon:'🚀', label:'קמפיין',        cost:15 },
  { id:'pixel',      href:'/pixel',       icon:'📊', label:'Pixel Builder', badge:'חדש' },
  { sec:'⚙️ ניהול' },
  { id:'team',       href:'/team',        icon:'👤', label:'צוות',          badge:'חדש' },
  { id:'agency',     href:'/agency',      icon:'🏢', label:'White-Label',   badge:'Pro' },
  { id:'credits',    href:'/credits',     icon:'💎', label:'קרדיטים' },
] as const;

interface SidebarProps { name: string; credits: number; plan: Plan; }

export default function Sidebar({ name, credits, plan }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

  const planConfig = PLAN_CONFIG[plan];
  const pct = Math.min(100, Math.round((credits / planConfig.credits) * 100));

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login'); router.refresh();
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <aside className="w-[230px] shrink-0 bg-[#0C1118] border-l border-[#1E2F42] fixed right-0 top-0 bottom-0 flex flex-col z-50 overflow-y-auto">
      <div className="px-4 py-4 border-b border-[#1E2F42]">
        <div className="text-[18px] font-bold text-white" style={{ fontFamily:'DM Serif Display,serif' }}>
          Ad<em className="text-[#D4AF55] not-italic">Master</em> Pro
        </div>
        <div className="text-[10px] text-[#2E4459] mt-0.5">AI Social Media Platform</div>
      </div>

      <nav className="flex-1 p-1.5">
        {NAV.map((item: any, i) => {
          if ('sec' in item) {
            return <div key={i} className="text-[9px] font-bold text-[#2E4459] uppercase tracking-widest px-2 py-1.5 mt-1">{item.sec}</div>;
          }
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href}
              className={clsx(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-all mb-0.5',
                active ? 'bg-[#0A7AFF]/12 text-[#3D9FFF] border border-[#0A7AFF]/18' : 'text-[#6B8FA8] hover:bg-[#162030] hover:text-[#D9E8F5] border border-transparent'
              )}>
              <span className="w-4 text-center text-[13px] flex-shrink-0">{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              {'badge' in item && !active && (
                <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0',
                  item.badge==='חדש'?'bg-[#059669]/15 text-[#34D399]':
                  item.badge==='Pro'?'bg-[#6D28D9]/15 text-[#A78BFA]':
                  'bg-[#0A7AFF] text-white')}>
                  {item.badge}
                </span>
              )}
              {'cost' in item && !('badge' in item) && !active && (
                <span className="text-[9px] bg-[#1D2D3E] text-[#6B8FA8] px-1.5 py-0.5 rounded-full flex-shrink-0">{item.cost}⚡</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-2.5 border-t border-[#1E2F42]">
        {credits < 20 && (
          <Link href="/credits" className="flex items-center justify-between bg-[#D97706]/10 border border-[#D97706]/20 rounded-lg px-2.5 py-1.5 mb-2 text-[11px] text-[#D97706] font-medium">
            ⚠️ קרדיטים נמוכים <span className="text-[10px]">טען →</span>
          </Link>
        )}
        <div className="bg-[#111A24] border border-[#1E2F42] rounded-lg p-2.5">
          <div className="flex justify-between items-center mb-1.5">
            <div>
              <div className="font-mono text-sm font-medium text-[#D9E8F5]">{credits.toLocaleString()}</div>
              <div className="text-[9px] text-[#2E4459]">קרדיטים</div>
            </div>
            <div className="text-[9px] font-bold px-2 py-0.5 rounded-full"
              style={{ background:`${planConfig.color}22`, color:planConfig.color, border:`1px solid ${planConfig.color}44` }}>
              {planConfig.name}
            </div>
          </div>
          <div className="h-1 rounded-full bg-[#1D2D3E] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width:`${pct}%`, background:pct<20?'#DC2626':'linear-gradient(90deg,#0A7AFF,#3D9FFF)' }}/>
          </div>
        </div>
        <button onClick={handleLogout} className="w-full mt-1.5 text-[10px] text-[#2E4459] hover:text-[#6B8FA8] transition-colors text-center py-1">
          👤 {name} · יציאה
        </button>
      </div>
    </aside>
  );
}
