// app/(dashboard)/onboarding/page.tsx
// First-run onboarding. Reads current onboarding state so the wizard resumes
// where the user left off.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

export const metadata = { title: 'התחלה' };

export default async function OnboardingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data } = await supabase.from('users').select('onboarding').eq('id', user.id).maybeSingle();
  const ob = (data?.onboarding ?? {}) as { step?: number; role?: 'agency' | 'freelancer'; completed_at?: string };

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader eyebrow="GETTING STARTED" title="בוא נתחיל" sub="פחות מ-2 דקות, ואתה באוויר." />
      <OnboardingWizard initialStep={ob.step ?? 0} initialRole={ob.role} />
    </div>
  );
}
