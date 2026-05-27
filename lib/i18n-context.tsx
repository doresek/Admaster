'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, getDict, getDir, parseLocale, type Locale } from './i18n';

interface I18nContextValue {
  locale:    Locale;
  setLocale: (l: Locale) => void;
  t:         ReturnType<typeof getDict>;
  dir:       'rtl' | 'ltr';
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readCookie(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`));
  return parseLocale(m?.[1]);
}

function writeCookie(locale: Locale) {
  if (typeof document === 'undefined') return;
  // 1 year, root path, lax — accessible from middleware too
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);

  // Hydrate from cookie on client
  useEffect(() => {
    const fromCookie = readCookie();
    if (fromCookie !== locale) setLocaleState(fromCookie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect locale in <html> attributes for proper styling
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dir  = getDir(locale);
  }, [locale]);

  function setLocale(l: Locale) {
    writeCookie(l);
    setLocaleState(l);
  }

  const value: I18nContextValue = {
    locale,
    setLocale,
    t:   getDict(locale),
    dir: getDir(locale),
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>');
  return ctx;
}

// Convenience helper for components that only need the dictionary
export function useT() {
  return useI18n().t;
}

export { LOCALES };
