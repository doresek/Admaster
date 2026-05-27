'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { MetaClient } from '@/types';

export function useMetaClients() {
  const [clients, setClients] = useState<MetaClient[]>([]);
  useEffect(() => {
    const s = createClient();
    s.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      s.from('meta_clients').select('*').eq('user_id', user.id).then(({ data }) => setClients(data ?? []));
    });
  }, []);
  return clients;
}
