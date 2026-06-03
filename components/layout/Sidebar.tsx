'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { clsx } from 'clsx';
import type { Plan } from '@/types';
import { PLAN_CONFIG } from '@/types';
import { useI18n, LOCALES } from '@/lib/i18n-context';
import { useState, useEffect } from 'react';

type NavItem =
  | { id: string; href: string; icon: string; labelKey: keyof ReturnType<typeof useI18n>['t']['nav']; cost?: number; badge?: 'new' | 'pro' }
  | { sec: keyof ReturnType<typeof useI18n>['t']['nav'] };

const NAV: NavItem[] = [
  { id:'dash',       href:'/',            icon:'⚡', labelKey:'dashboard' },
  { id:'brand',      href:'/brand',       icon:'🧬', labelKey:'brand' },
  { sec:'sec_analyze' },
  { id:'analytics',  href:'/analytics',   icon:'📈', labelKey:'analytics',  badge:'new' },
  { id:'competitor', href:'/competitor',  icon:'🔍', labelKey:'competitor', badge:'new' },
  { id:'reports',    href:'/reports',     icon:'📋', labelKey:'reports',    badge:'new' },
  { sec:'sec_create' },
  { id:'quick',      href:'/quick-campaign', icon:'🚀', labelKey:'quick_campaign', cost:15, badge:'new' },
  { id:'create',     href:'/create',      icon:'✨', labelKey:'create',     cost:3 },
  { id:'images',     href:'/images',      icon:'🎨', labelKey:'images',     cost:5, badge:'new' },
  { id:'analyze',    href:'/analyze',     icon:'🔬', labelKey:'analyze',    cost:5 },
  { id:'variations', href:'/variations',  icon:'🔀', labelKey:'variations', cost:8 },
  { id:'lab',        href:'/lab',         icon:'🧪', labelKey:'lab',        badge:'new' },
  { id:'refine',     href:'/refine',      icon:'🔁', labelKey:'refine',     cost:4, badge:'new' },
  { id:'calendar',   href:'/calendar',    icon:'📅', labelKey:'calendar',   cost:3 },
  { sec:'sec_messages' },
  { id:'messages',   href:'/messages',    icon:'📧', labelKey:'messages',   cost:3,  badge:'new' },
  { id:'series',     href:'/series',      icon:'🗓', labelKey:'series',     cost:20, badge:'new' },
  { sec:'sec_content' },
  { id:'landing',    href:'/landing-pages', icon:'📄', labelKey:'landing',   badge:'new' },
  { id:'schedule',   href:'/schedule',    icon:'🗓', labelKey:'schedule',   badge:'new' },
  { id:'approvals',  href:'/approvals',   icon:'✅', labelKey:'approvals',  badge:'new' },
  { id:'library',    href:'/library',     icon:'📚', labelKey:'library',    badge:'new' },
  { id:'history',    href:'/history',     icon:'🕒', labelKey:'history',    badge:'new' },
  { sec:'sec_meta' },
  { id:'clients',    href:'/clients',     icon:'👥', labelKey:'clients' },
  { id:'briefs',     href:'/briefs',      icon:'📝', labelKey:'briefs' },
  { id:'publish',    href:'/publish',     icon:'📤', labelKey:'publish',    cost:2 },
  { id:'campaign',   href:'/campaign',    icon:'🚀', labelKey:'campaign',   cost:15 },
  { id:'ads_launcher', href:'/ads-launcher', icon:'📣', labelKey:'ads_launcher', cost:15, badge:'new' },
  { id:'pixel',      href:'/pixel',       icon:'📊', labelKey:'pixel',      badge:'new' },
  { sec:'sec_manage' },
  { id:'team',       href:'/team',        icon:'👤', labelKey:'team',       badge:'new' },
  { id:'agency',     href:'/agency',      icon:'🏢', labelKey:'agency',     badge:'pro' },
  { id:'support',    href:'/support',     icon:'🎫', labelKey:'support',    badge:'new' },
  { id:'credits',    href:'/credits',     icon:'💎', labelKey:'credits' },
];

interface SidebarProps { name: string; credits: number; plan: Plan; }

const COLLAPSE_COOKIE = 'admaster_sidebar_collapsed';

function readCollapsed(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.includes(`${COLLAPSE_COOKIE}=1`);
}
function writeCollapsed(v: boolean) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COLLAPSE_COOKIE}=${v ? 1 : 0}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export default function Sidebar({ name, credits, plan }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();
  const { t, locale, setLocale } = useI18n();
  const [langOpen, setLangOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(false);
  useEffect(() => { setCollapsedState(readCollapsed()); }, []);

  function setCollapsed(v: boolean) {
    writeCollapsed(v);
    setCollapsedState(v);
  }

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

  // Sidebar side flips based on direction: RTL → right edge; LTR → left edge
  const sideClass = locale === 'en' ? 'left-0 border-r' : 'right-0 border-l';
  const widthClass = collapsed ? 'w-[64px]' : 'w-[230px]';

  return (
    <aside className={clsx('shrink-0 bg-[#0C1118] border-[#1E2F42] fixed top-0 bottom-0 flex flex-col z-50 overflow-y-auto transition-all duration-200', widthClass, sideClass)}>
      <div className="px-4 py-4 border-b border-[#1E2F42] flex items-center justify-between">
        {!collapsed && (
          <div>
            <div className="text-[18px] font-bold text-white" style={{ fontFamily:'DM Serif Display,serif' }}>
              Ad<em className="text-[#D4AF55] not-italic">Master</em> Pro
            </div>
            <div className="text-[10px] text-[#2E4459] mt-0.5">AI Social Media Platform</div>
          </div>
        )}
        <button onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'הרחב' : 'מזער'}
          className="text-[#6B8FA8] hover:text-[#D9E8F5] text-base p-1 rounded hover:bg-[#162030] transition-colors flex-shrink-0">
          {collapsed ? (locale === 'en' ? '→' : '←') : (locale === 'en' ? '←' : '→')}
        </button>
      </div>

      {/* Quick external links (always visible icons; collapsed-aware) */}
      <div className={clsx('px-2 py-2 border-b border-[#1E2F42] flex gap-1', collapsed ? 'flex-col' : 'flex-row')}>
        <a href="https://chat.whatsapp.com/" target="_blank" rel="noreferrer"
          title="קהילת WhatsApp"
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#059669]/8 border border-[#059669]/20 text-[#34D399] hover:bg-[#059669]/15 transition-colors text-[11px] font-bold">
          <span>💬</span>{!collapsed && <span>קהילה</span>}
        </a>
        <a href="https://admaster-pro.co.il/course" target="_blank" rel="noreferrer"
          title="הקורס לשימוש"
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#0A7AFF]/8 border border-[#0A7AFF]/20 text-[#3D9FFF] hover:bg-[#0A7AFF]/15 transition-colors text-[11px] font-bold">
          <span>🎓</span>{!collapsed && <span>קורס</span>}
        </a>
      </div>

      <nav className="flex-1 p-1.5">
        {NAV.map((item, i) => {
          if ('sec' in item) {
            if (collapsed) return <div key={i} className="border-t border-[#1E2F42] my-2" />;
            return <div key={i} className="text-[9px] font-bold text-[#2E4459] uppercase tracking-widest px-2 py-1.5 mt-1">{t.nav[item.sec]}</div>;
          }
          const active = isActive(item.href);
          const label = t.nav[item.labelKey];
          const badgeText = item.badge === 'new' ? t.common.new : item.badge === 'pro' ? t.common.pro : null;
          return (
            <Link key={item.href} href={item.href}
              title={collapsed ? label : undefined}
              className={clsx(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-all mb-0.5',
                active ? 'bg-[#0A7AFF]/12 text-[#3D9FFF] border border-[#0A7AFF]/18' : 'text-[#6B8FA8] hover:bg-[#162030] hover:text-[#D9E8F5] border border-transparent'
              )}>
              <span className={clsx('text-[13px] flex-shrink-0', collapsed ? 'mx-auto' : 'w-4 text-center')}>{item.icon}</span>
              {!collapsed && <span className="flex-1 truncate">{label}</span>}
              {!collapsed && item.badge && !active && badgeText && (
                <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0',
                  item.badge === 'new' ? 'bg-[#059669]/15 text-[#34D399]' :
                  item.badge === 'pro' ? 'bg-[#6D28D9]/15 text-[#A78BFA]' :
                  'bg-[#0A7AFF] text-white')}>
                  {badgeText}
                </span>
              )}
              {!collapsed && 'cost' in item && item.cost !== undefined && !item.badge && !active && (
                <span className="text-[9px] bg-[#1D2D3E] text-[#6B8FA8] px-1.5 py-0.5 rounded-full flex-shrink-0">{item.cost}⚡</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-2.5 border-t border-[#1E2F42]">
        {/* Language switcher */}
        <div className="relative mb-2">
          <button onClick={() => setLangOpen(o => !o)}
            title={collapsed ? t.common.language : undefined}
            className="w-full flex items-center justify-between bg-[#162030] border border-[#1E2F42] rounded-lg px-2.5 py-1.5 text-[11px] text-[#6B8FA8] hover:border-[#2A4158] transition-colors">
            <span className="flex items-center gap-1">🌐 {!collapsed && <>{LOCALES.find(l => l.id === locale)?.emoji} {LOCALES.find(l => l.id === locale)?.name}</>}</span>
            {!collapsed && <span className="text-[8px]">▾</span>}
          </button>
          {langOpen && (
            <div className="absolute bottom-full mb-1 left-0 right-0 bg-[#111A24] border border-[#1E2F42] rounded-lg overflow-hidden shadow-xl z-50 min-w-[120px]">
              {LOCALES.map(l => (
                <button key={l.id}
                  onClick={() => { setLocale(l.id); setLangOpen(false); }}
                  className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-[11.5px] transition-colors',
                    l.id === locale ? 'bg-[#0A7AFF]/12 text-[#3D9FFF]' : 'text-[#6B8FA8] hover:bg-[#162030] hover:text-[#D9E8F5]')}>
                  <span>{l.emoji}</span>{l.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {credits < 20 && !collapsed && (
          <Link href="/credits" className="flex items-center justify-between bg-[#D97706]/10 border border-[#D97706]/20 rounded-lg px-2.5 py-1.5 mb-2 text-[11px] text-[#D97706] font-medium">
            ⚠️ {t.common.credits} <span className="text-[10px]">→</span>
          </Link>
        )}
        {!collapsed ? (
          <div className="bg-[#111A24] border border-[#1E2F42] rounded-lg p-2.5">
            <div className="flex justify-between items-center mb-1.5">
              <div>
                <div className="font-mono text-sm font-medium text-[#D9E8F5]">{credits.toLocaleString()}</div>
                <div className="text-[9px] text-[#2E4459]">{t.common.credits}</div>
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
        ) : (
          <Link href="/credits" title={`${credits} ${t.common.credits}`}
            className="block text-center bg-[#111A24] border border-[#1E2F42] rounded-lg p-1.5">
            <div className="font-mono text-[10px] text-[#D9E8F5]">{credits >= 1000 ? `${Math.floor(credits/1000)}k` : credits}</div>
            <div className="text-[8px] text-[#2E4459]">⚡</div>
          </Link>
        )}
        <button onClick={handleLogout} title={collapsed ? t.common.logout : undefined}
          className="w-full mt-1.5 text-[10px] text-[#2E4459] hover:text-[#6B8FA8] transition-colors text-center py-1 truncate">
          {collapsed ? '🚪' : `👤 ${name} · ${t.common.logout}`}
        </button>
      </div>
    </aside>
  );
}
