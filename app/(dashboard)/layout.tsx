import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import type { Plan } from '@/types';

export const metadata: Metadata = {
  title: { template: '%s | AdMaster Pro', default: 'AdMaster Pro' },
  description: 'AI Social Media Platform',
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('name, credits, plan').eq('id', user.id).single();

  return (
    <div className="flex min-h-screen bg-[#070A0E] text-[#D9E8F5]" dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}>
      <Sidebar
        name={profile?.name ?? user.email?.split('@')[0] ?? ''}
        credits={profile?.credits ?? 0}
        plan={(profile?.plan as Plan) ?? 'free'}
      />
      <main className="mr-[220px] flex-1 px-8 py-7 min-h-screen">{children}</main>
    </div>
  );
}
