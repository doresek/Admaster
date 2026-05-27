import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { I18nProvider } from '@/lib/i18n-context';
import { parseLocale, getDir, LOCALE_COOKIE } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'AdMaster Pro',
  description: 'AI Social Media Platform — Powered by Claude',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read locale from cookie at SSR time to avoid FOUC
  const locale = parseLocale(cookies().get(LOCALE_COOKIE)?.value);
  const dir    = getDir(locale);
  const lang   = locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'he';

  return (
    <html lang={lang} dir={dir}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@300;400;500;600;700&family=Noto+Sans+Arabic:wght@300;400;500;600;700&family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: "'Noto Sans Hebrew', 'Noto Sans Arabic', sans-serif" }}>
        <I18nProvider initialLocale={locale}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
