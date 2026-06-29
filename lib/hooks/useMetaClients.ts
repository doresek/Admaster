'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { clientToMetaClient } from '@/lib/clients';
import type { MetaClient } from '@/types';

// Client-list identity reads now come from the v2 `clients` table (business
// identity), adapted to the legacy MetaClient shape via clientToMetaClient.
// Meta assets/credentials still resolve separately via getActiveConnection.
export function useMetaClients() {
  const [clients, setClients] = useState<MetaClient[]>([]);
  useEffect(() => {
    const s = createClient();
    s.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      s.from('clients')
        .select('id, name, owner_user_id, created_at, updated_at')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => setClients((data ?? []).map(clientToMetaClient)));
    });
  }, []);
  return clients;
}
