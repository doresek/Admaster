import { useCallback, useState } from 'react';
import type { CreditAction } from '@/types';

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
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, system, prompt, maxTokens, platform }),
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
  const costs: Record<CreditAction, number> = {
    post: 3, analyze: 5, variations: 8, holiday: 3,
    publish: 2, campaign: 15, avatar: 10, avatar_v2: 20, ads_avatar: 8, funnel: 12,
  };
  return costs[action] ?? 0;
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
