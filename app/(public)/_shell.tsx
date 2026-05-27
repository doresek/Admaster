'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useI18n, LOCALES } from '@/lib/i18n-context';
import { clsx } from 'clsx';
import type { Locale } from '@/lib/i18n';

interface Props {
  locale:   Locale;
  children: React.ReactNode;
}

export default function PublicShell({ children }: Props) {
  const { t, locale, setLocale, dir } = useI18n();
  const [langOpen, setLangOpen] = useState(false);

  const NAV = [
    { href: '/welcome',      label: t.public.home },
    { href: '/features',     label: t.public.features },
    { href: '/pricing',      label: t.public.pricing },
    { href: '/how-it-works', label: t.public.how_it_works },
    { href: '/faq',          label: t.public.faq },
    { href: '/blog',         label: t.public.blog },
    { href: '/contact',      label: t.public.contact },
  ];

  return (
    <div className="min-h-screen bg-[#0B1424] text-[#D9E8F5]" dir={dir}>
      <header className="sticky top-0 z-50 bg-[#0B1424]/85 backdrop-blur border-b border-[#243752]">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/welcome" className="text-lg font-bold text-white" style={{ fontFamily: 'DM Serif Display,serif' }}>
            Ad<em className="text-[#D4AF55] not-italic">Master</em> Pro
          </Link>
          <nav className="hidden md:flex items-center gap-5 text-[13px] text-[#6B8FA8]">
            {NAV.map(n => (
              <Link key={n.href} href={n.href} className="hover:text-white transition-colors">{n.label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {/* Language switcher */}
            <div className="relative">
              <button onClick={() => setLangOpen(o => !o)}
                className="px-2.5 py-1.5 text-[12px] text-[#6B8FA8] hover:text-white border border-[#243752] hover:border-[#324C6B] rounded-lg transition-colors">
                {LOCALES.find(l => l.id === locale)?.emoji} <span className="hidden sm:inline">{LOCALES.find(l => l.id === locale)?.name}</span>
              </button>
              {langOpen && (
                <div className="absolute top-full mt-1 right-0 bg-[#152138] border border-[#243752] rounded-lg overflow-hidden shadow-xl z-50 min-w-[140px]">
                  {LOCALES.map(l => (
                    <button key={l.id}
                      onClick={() => { setLocale(l.id); setLangOpen(false); }}
                      className={clsx('w-full flex items-center gap-2 px-3 py-2 text-[12.5px] transition-colors text-start',
                        l.id === locale ? 'bg-[#0A7AFF]/12 text-[#3D9FFF]' : 'text-[#6B8FA8] hover:bg-[#1A2A42] hover:text-[#D9E8F5]')}>
                      <span>{l.emoji}</span>{l.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Link href="/login"    className="text-[13px] text-[#6B8FA8] hover:text-white px-3 py-1.5">{t.common.login}</Link>
            <Link href="/register" className="text-[13px] font-bold bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white px-4 py-1.5 rounded-lg transition-colors">{t.public.start_free}</Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-[#243752] mt-20">
        <div className="max-w-6xl mx-auto px-4 py-10 grid md:grid-cols-4 gap-8 text-sm">
          <div>
            <div className="text-base font-bold text-white mb-2" style={{ fontFamily: 'DM Serif Display,serif' }}>
              Ad<em className="text-[#D4AF55] not-italic">Master</em> Pro
            </div>
            <div className="text-[#6B8FA8] text-[12.5px] leading-relaxed">{t.public.hero_title_pre} {t.public.hero_title_em} {t.public.hero_title_post}.</div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-[#2E4459] uppercase mb-3">{t.public.features}</div>
            <ul className="space-y-1.5 text-[#6B8FA8]">
              <li><Link href="/features" className="hover:text-white">{t.public.features}</Link></li>
              <li><Link href="/pricing" className="hover:text-white">{t.public.pricing}</Link></li>
              <li><Link href="/how-it-works" className="hover:text-white">{t.public.how_it_works}</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-[11px] font-bold text-[#2E4459] uppercase mb-3">{t.public.faq}</div>
            <ul className="space-y-1.5 text-[#6B8FA8]">
              <li><Link href="/faq" className="hover:text-white">{t.public.faq}</Link></li>
              <li><Link href="/contact" className="hover:text-white">{t.public.contact}</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-[11px] font-bold text-[#2E4459] uppercase mb-3">{t.common.login}</div>
            <ul className="space-y-1.5 text-[#6B8FA8]">
              <li><Link href="/login" className="hover:text-white">{t.common.login}</Link></li>
              <li><Link href="/register" className="hover:text-white">{t.common.register}</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[#243752] py-4 text-center text-[11px] text-[#2E4459]">
          © {new Date().getFullYear()} AdMaster Pro
        </div>
      </footer>
    </div>
  );
}
