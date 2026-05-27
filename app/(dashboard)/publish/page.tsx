'use client';
import { useState } from 'react';
import { Card, CardLabel, Textarea, Btn, Alert, PageHeader, CostBadge } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { useMetaClients } from '@/lib/hooks/useMetaClients';
import type { MetaClient } from '@/types';

export default function PublishPage() {
  const clients = useMetaClients();
  const [selC,    setSelC]    = useState<MetaClient|null>(null);
  const [text,    setText]    = useState('');
  const [brief,   setBrief]   = useState('');
  const [genLoading, setGenL] = useState(false);
  const [pubLoading, setPubL] = useState(false);
  const [published, setPub]   = useState('');
  const [err,     setErr]     = useState('');
  const { call } = useAI();

  const page = selC?.pages.find(p => p.id === selC.selected_page_id);

  async function genPost() {
    if (!brief.trim()) return;
    setGenL(true);
    const raw = await call('post', `כתוב פוסט קצר לFacebook עבור ${selC?.name || 'עסק'}. החזר רק את הטקסט.`, brief, 400);
    if (raw) setText(raw);
    setGenL(false);
  }

  async function publish() {
    if (!text.trim() || !selC || !page) return;
    setErr(''); setPubL(true);
    try {
      const res = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selC.id, path: `${page.id}/feed`, body: { message: text } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPub(data.id);
      // Deduct credits
      await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', system: '', prompt: '' }) });
    } catch (e: any) { setErr(e.message); }
    finally { setPubL(false); }
  }

  if (clients.length === 0) return (
    <div><PageHeader eyebrow="Meta" title="פרסם פוסט" /><Alert type="amber">⚠️ הוסף לקוח Meta תחילה <a href="/clients" className="font-bold underline">לדף לקוחות →</a></Alert></div>
  );

  return (
    <div>
      <PageHeader eyebrow="Meta" title="פרסם פוסט" sub="פרסום ישיר לדף Facebook" right={<CostBadge cost={2} />} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>לקוח</CardLabel>
            <div className="flex flex-wrap gap-2 mb-3">
              {clients.map(c => <button key={c.id} onClick={() => setSelC(c)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${selC?.id===c.id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158]'}`}>
                <span>{c.emoji}</span>{c.name}
              </button>)}
            </div>
            {page && <Alert type="green">📘 יפורסם ל: <strong>{page.name}</strong></Alert>}
          </Card>

          <Card className="mb-3">
            <CardLabel>בריף לAI</CardLabel>
            <Textarea value={brief} onChange={setBrief} placeholder="תאר מה לפרסם..." rows={2} />
            <Btn variant="ghost" size="sm" loading={genLoading} onClick={genPost} disabled={!brief.trim()}>✨ צור עם AI</Btn>
          </Card>

          <Card className="mb-3">
            <CardLabel>טקסט הפוסט</CardLabel>
            <Textarea value={text} onChange={setText} placeholder="כתוב פוסט..." rows={6} />
          </Card>

          {err && <Alert type="red">{err}</Alert>}
          {published && <Alert type="green">✅ פורסם! Post ID: {published}</Alert>}

          <Btn variant="primary" full loading={pubLoading} onClick={publish} disabled={!text.trim() || !page}>
            📤 פרסם ל-{page?.name || 'דף'}
          </Btn>
        </div>

        <div>
          <div className="text-xs text-[#6B8FA8] mb-2">תצוגה מקדימה</div>
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-[#1D2D3E] flex items-center justify-center text-base">📘</div>
              <div>
                <div className="font-semibold text-sm">{page?.name || 'הדף שלך'}</div>
                <div className="text-[10px] text-[#2E4459]">עכשיו · 🌍</div>
              </div>
            </div>
            <div className="text-sm leading-relaxed whitespace-pre-wrap min-h-[80px]" style={{ color: text ? '#D9E8F5' : '#2E4459' }}>
              {text || 'הפוסט יופיע כאן...'}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
