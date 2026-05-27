import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import PublicShell from './_shell';
import { parseLocale, LOCALE_COOKIE } from '@/lib/i18n';

export const metadata: Metadata = {
  title: { template: '%s | AdMaster Pro', default: 'AdMaster Pro — AI לשיווק' },
  description: 'AI שמייצר מודעות, פוסטים וקמפיינים — מבריף ועד פרסום ב-Meta. בעברית, אנגלית וערבית.',
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const locale = parseLocale(cookies().get(LOCALE_COOKIE)?.value);
  return <PublicShell locale={locale}>{children}</PublicShell>;
}
