'use client';
// ═══════════════════════════════════════════════════════════════════════════
// ClientProvider — the SINGLE SOURCE OF TRUTH for the active client, propagated
// to EVERY dashboard screen. Pick a client once (in the top ClientSwitcher) and
// the whole app operates in that client's context: Create Post, Campaigns,
// Analysis, briefs — all read the same active client + its existing brief/brain,
// with no second place to choose a client and no re-entry.
//
// Reactive: setActiveClient updates the context state (so client components
// re-render instantly) AND writes the cookie + router.refresh() (so server
// components re-read it). One switch → the whole app follows.
// See docs/CLIENT-UX-PLAN.md §"Client-context propagation".
// ═══════════════════════════════════════════════════════════════════════════
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { writeActiveClientCookie } from '@/lib/active-client';

export interface ActiveClientInfo {
  id:       string;
  name:     string;
  industry: string | null;
  emoji:    string;
}

interface ClientContextValue {
  /** The active client's id, or null for "no client (Brand DNA only)". */
  activeClientId: string | null;
  /** The resolved active client, or null. */
  activeClient:   ActiveClientInfo | null;
  /** All of the owner's clients (for the switcher + any picker that reads context). */
  clients:        ActiveClientInfo[];
  /** The active client's most-recent brief id (so screens ground in it, no re-brief). */
  activeBriefId:  string | null;
  /** Whether the active client already has a non-empty brief (skip a new short brief). */
  activeHasBrief: boolean;
  /** Set the active client everywhere (cookie + context + server refresh). */
  setActiveClient: (id: string | null) => Promise<void>;
  loading:        boolean;
  /** Re-pull clients + active from the server. */
  refresh:        () => Promise<void>;
}

const ClientContext = createContext<ClientContextValue | null>(null);

export function ClientProvider({
  initialActive,
  children,
}: {
  initialActive: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [activeClientId, setActiveClientId] = useState<string | null>(initialActive);
  const [clients,        setClients]        = useState<ActiveClientInfo[]>([]);
  const [activeBriefId,  setActiveBriefId]  = useState<string | null>(null);
  const [activeHasBrief, setActiveHasBrief] = useState(false);
  const [loading,        setLoading]        = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/active-client', { cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      setClients(d.clients ?? []);
      setActiveClientId(d.active ?? null);
      setActiveBriefId(d.brief_id ?? null);
      setActiveHasBrief(!!d.has_brief);
    } catch { /* transient — keep current context */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setActiveClient = useCallback(async (id: string | null) => {
    setLoading(true);
    try {
      const res = await fetch('/api/active-client', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id }),
      });
      if (res.ok) {
        setActiveClientId(id);
        writeActiveClientCookie(id);
        // Re-pull the new active client's brief info, then refresh server components.
        await load();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }, [router, load]);

  const activeClient = clients.find((c) => c.id === activeClientId) ?? null;

  return (
    <ClientContext.Provider
      value={{ activeClientId, activeClient, clients, activeBriefId, activeHasBrief, setActiveClient, loading, refresh: load }}
    >
      {children}
    </ClientContext.Provider>
  );
}

/** Read the app-wide active client. Must be used inside <ClientProvider>. */
export function useActiveClient(): ClientContextValue {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useActiveClient must be used within <ClientProvider>');
  return ctx;
}
