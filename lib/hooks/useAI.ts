import { useCallback, useState } from 'react';
import { CREDIT_COSTS, type CreditAction } from '@/types';
import { LOCALE_COOKIE, parseLocale, type Locale } from '@/lib/i18n';

function currentLocale(): Locale {
  if (typeof document === 'undefined') return 'he';
  const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`));
  return parseLocale(m?.[1]);
}

interface UseAIOptions {
  onCreditsUpdated?: (credits: number) => void;
  onError?: (error: string) => void;
}

export function useAI({ onCreditsUpdated, onError }: UseAIOptions = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (
    action: CreditAction,
    system: string,
    prompt: string,
    maxTokens = 1200,
    platform?: string,
  ): Promise<string | null> => {
    setLoading(true);
    setError(null);

    try {
      const locale = currentLocale();
      // Append a small language hint so AI responds in the user's locale, regardless of caller
      const langSuffix = locale === 'en' ? '\n\nRespond in English.'
                       : locale === 'ar' ? '\n\nأجب بالعربية.'
                       : '';
      const systemWithLocale = system + langSuffix;
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, system: systemWithLocale, prompt, maxTokens, platform, locale }),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data.error === 'insufficient_credits'
          ? `אין מספיק קרדיטים (נדרש ${getCost(action)})`
          : data.error || 'שגיאה לא ידועה';
        setError(msg);
        onError?.(msg);
        return null;
      }

      if (data.credits !== undefined) {
        onCreditsUpdated?.(data.credits);
      }

      return data.text;
    } catch (e: any) {
      const msg = e.message || 'Network error';
      setError(msg);
      onError?.(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [onCreditsUpdated, onError]);

  return { call, loading, error, clearError: () => setError(null) };
}

function getCost(action: CreditAction): number {
  return CREDIT_COSTS[action] ?? 0;
}

// ── Meta API hook ─────────────────────────────
export function useMeta() {
  const get = useCallback(async (clientId: string, path: string, fields?: string) => {
    const params = new URLSearchParams({ clientId, path, ...(fields ? { fields } : {}) });
    const res = await fetch(`/api/meta?${params}`);
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }, []);

  const post = useCallback(async (clientId: string, path: string, body: object) => {
    const res = await fetch('/api/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, path, body }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }, []);

  return { get, post };
}
