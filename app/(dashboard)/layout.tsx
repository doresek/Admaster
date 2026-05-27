import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { CreditsBadge } from '@/components/CreditsBadge';
import { FAB } from '@/components/FAB';
import type { Plan } from '@/types';
import { parseLocale, getDir, LOCALE_COOKIE } from '@/lib/i18n';

export const metadata: Metadata = {
  title: { template: '%s | AdMaster Pro', default: 'AdMaster Pro' },
  description: 'AI Social Media Platform',
};

const COLLAPSE_COOKIE = 'admaster_sidebar_collapsed';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('name, credits, plan').eq('id', user.id).single();

  const c          = cookies();
  const locale     = parseLocale(c.get(LOCALE_COOKIE)?.value);
  const dir        = getDir(locale);
  const collapsed  = c.get(COLLAPSE_COOKIE)?.value === '1';
  const offsetSize = collapsed ? '64px' : '220px';
  const offsetSide = dir === 'rtl' ? 'mr' : 'ml';

  return (
    <div className="flex min-h-screen bg-[#070A0E] text-[#D9E8F5]" dir={dir}>
      <Sidebar
        name={profile?.name ?? user.email?.split('@')[0] ?? ''}
        credits={profile?.credits ?? 0}
        plan={(profile?.plan as Plan) ?? 'free'}
      />
      <div
        className="flex-1 transition-all duration-200"
        style={{ [offsetSide === 'mr' ? 'marginRight' : 'marginLeft']: offsetSize }}
      >
        {/* Top bar with credits + bell */}
        <div className="sticky top-0 z-40 bg-[#070A0E]/85 backdrop-blur border-b border-[#1E2F42] px-8 py-2 flex items-center justify-end gap-3">
          <CreditsBadge
            initialCredits={profile?.credits ?? 0}
            initialPlan={(profile?.plan as Plan) ?? 'free'}
          />
          <NotificationBell />
        </div>
        <main className="px-8 py-7 min-h-screen">{children}</main>
      </div>
      <FAB />
    </div>
  );
}
