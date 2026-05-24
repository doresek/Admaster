'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Textarea, Btn, Alert, PageHeader, CostBadge } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import type { MetaClient } from '@/types';

export default function PublishPage() {
  const [clients, setClients] = useState<MetaClient[]>([]);
  const [selC, setSelC] = useState<MetaClient|null>(null);
  const [text, setText] = useState('');
  const [brief, setBrief] = useState('');
  const [genL, setGenL] = useState(false);
  const [pubL, setPubL] = useState(false);
  const [published, setPublished] = useState('');
  const [err, setErr] = useState('');
  const { call } = useAI();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('meta_clients').select('*').eq('user_id', user.id)
        .then(({ data }) => { setClients(data ?? []); if (data?.[0]) setSelC(data[0]); });
    });
  }, []);

  const page = selC?.pages.find(p => p.id === selC.selected_page_id);

  async function genPost() {
    if (!brief.trim()) return;
    setGenL(true);
    const raw = await call('post', `כתוב פוסט קצר לFacebook עבור ${selC?.name || 'עסק'}. החזר רק את הטקסט.`, brief, 400);
    if (raw) setText(raw);
    setGenL(false);
  }

  async function publish() {
    if (!text.trim() || !selC || !page)
