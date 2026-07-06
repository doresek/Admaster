'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Card, CardLabel, Textarea, Input, Btn, Alert, PageHeader, CostBadge } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { useMetaClients } from '@/lib/hooks/useMetaClients';
import { useActiveClient } from '@/components/ClientProvider';
import { AdThumb } from '@/components/approvals/AdPreview';
import { normalizeAdContent } from '@/components/approvals/ad-content';
import type { MetaClient } from '@/types';

// Shape of one row from GET /api/approvals (bare array response).
interface ApprovalRow {
  id: string;
  client_id: string | null;
  title: string | null;
  content: unknown;
  status: string;
  created_at: string;
  responded_at: string | null;
}

function approvedDate(row: ApprovalRow): string {
  const d = new Date(row.responded_at ?? row.created_at);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL');
}

export default function PublishPage() {
  const clients = useMetaClients();
  const { activeClientId } = useActiveClient();
  const [selC,    setSelC]    = useState<MetaClient|null>(null);
  const [text,    setText]    = useState('');
  const [link,    setLink]    = useState('');
  const [brief,   setBrief]   = useState('');
  const [genLoading, setGenL] = useState(false);
  const [pubLoading, setPubL] = useState(false);
  const [published, setPub]   = useState('');
  const [err,     setErr]     = useState('');
  // ── Approved-ads pipeline (create → approve → PUBLISH) ──
  const [approved, setApproved]         = useState<ApprovalRow[]>([]);
  const [approvedLoaded, setApprLoaded] = useState(false);
  const [fromApproval, setFromApproval] = useState<ApprovalRow|null>(null);
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());
  const [scratchOpen, setScratchOpen]   = useState(false);
  const { call } = useAI();

  const page = selC?.pages.find(p => p.id === selC.selected_page_id);

  // Default the selected client to the app-wide active client (top switcher is
  // the source of truth — the owner does not re-pick here).
  useEffect(() => {
    if (selC || !activeClientId || clients.length === 0) return;
    const match = clients.find(c => c.id === activeClientId);
    if (match) setSelC(match);
  }, [clients, activeClientId, selC]);

  // Fetch the selected client's APPROVED ads. Best-effort only — a failure
  // here must never block the composer/publish flow.
  useEffect(() => {
    const cid = selC?.id;
    if (!cid) return;
    let cancelled = false;
    setApprLoaded(false);
    (async () => {
      try {
        const res = await fetch(`/api/approvals?client_id=${encodeURIComponent(cid)}`);
        if (!res.ok) return;
        const rows = await res.json();
        if (!cancelled && Array.isArray(rows)) {
          setApproved(rows.filter((r: ApprovalRow) => r?.status === 'approved'));
        }
      } catch { /* composer still works without the approvals list */ }
      finally { if (!cancelled) setApprLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [selC?.id]);

  // Load an approved ad's content into the composer:
  // message = post text + hashtags; image_url → the link field (Graph /feed `link`).
  function loadApproved(row: ApprovalRow) {
    const ad = normalizeAdContent(row.content);
    const tags = ad.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ');
    setText(tags ? `${ad.text}\n\n${tags}`.trim() : ad.text);
    setLink(ad.imageUrl ?? '');
    setFromApproval(row);
    setPub(''); setErr('');
  }

  function clearApprovedSelection() {
    setFromApproval(null);
  }

  async function genPost() {
    if (!brief.trim()) return;
    setGenL(true);
    const raw = await call('post', `כתוב פוסט קצר לFacebook עבור ${selC?.name || 'עסק'}. החזר רק את הטקסט.`, brief, 400);
    if (raw) { setText(raw); setFromApproval(null); }
    setGenL(false);
  }

  async function publish() {
    if (!text.trim() || !selC || !page) return;
    setErr(''); setPubL(true);
    try {
      const res = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selC.id,
          path: `${page.id}/feed`,
          body: { message: text, ...(link.trim() ? { link: link.trim() } : {}) },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPub(data.id);
      // Close the loop visually: mark the approved card as published.
      // (The approvals status vocabulary has no 'published' — client-side marker only.)
      if (fromApproval) {
        const id = fromApproval.id;
        setPublishedIds(prev => new Set(prev).add(id));
      }
      // Deduct credits
      await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', system: '', prompt: '' }) });
    } catch (e: any) { setErr(e.message); }
    finally { setPubL(false); }
  }

  if (clients.length === 0) return (
    <div><PageHeader eyebrow="Meta" title="פרסם פוסט" /><Alert type="amber">⚠️ הוסף לקוח Meta תחילה <Link href="/clients" className="font-bold underline">לדף לקוחות →</Link></Alert></div>
  );

  const hasApproved = approved.length > 0;
  // "צור מאפס" is secondary (collapsed) when approved items exist; primary otherwise.
  const scratchExpanded = hasApproved ? scratchOpen : true;

  return (
    <div>
      <PageHeader eyebrow="Meta" title="פרסם פוסט" sub="פרסום ישיר לדף Facebook" right={<CostBadge cost={2} />} />

      {/* ══ PRIMARY: מודעות מאושרות — the pipeline's publish step ══ */}
      {selC && (
        <Card className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-1">
            <CardLabel>✅ מודעות מאושרות</CardLabel>
            {hasApproved && <span className="text-[11px] text-[#6B8FA8]">{approved.length} ממתינות לפרסום</span>}
          </div>
          <div className="text-[11px] text-[#2E4459] mb-3">מצב אישור ידני — מודעות מאושרות ממתינות לפרסום שלך</div>

          {hasApproved ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {approved.map(row => {
                const isSelected  = fromApproval?.id === row.id;
                const isPublished = publishedIds.has(row.id);
                return (
                  <button
                    key={row.id}
                    onClick={() => loadApproved(row)}
                    className={`text-right rounded-lg border p-2.5 transition-all ${
                      isSelected
                        ? 'border-[#0A7AFF] bg-[#0A7AFF]/12'
                        : 'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]'
                    }`}
                  >
                    <AdThumb content={row.content} />
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <span className="text-[10px] text-[#2E4459]">אושר ב-{approvedDate(row)}</span>
                      {isPublished
                        ? <span className="text-[10px] font-bold text-[#34D399]">פורסם ✓</span>
                        : isSelected
                          ? <span className="text-[10px] font-bold text-[#3D9FFF]">נבחר ✓</span>
                          : <span className="text-[10px] text-[#6B8FA8]">לחץ לטעינה →</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : approvedLoaded ? (
            <div className="text-sm text-[#6B8FA8]">
              אין עדיין מודעות מאושרות — צור פוסט ואשר אותו{' '}
              <Link href="/create" className="font-bold underline text-[#3D9FFF]">ליצירת פוסט →</Link>
            </div>
          ) : (
            <div className="text-[11px] text-[#2E4459]">טוען מודעות מאושרות…</div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>לקוח</CardLabel>
            {activeClientId ? (
              <div className="flex items-center gap-2 mb-3">
                <span>{selC?.emoji}</span>
                <span className="text-sm font-medium">פועל על: {selC?.name}</span>
                <span className="ml-auto text-[11px] text-[#2E4459]">לשינוי — החלף לקוח במתג למעלה</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 mb-3">
                {clients.map(c => <button key={c.id} onClick={() => setSelC(c)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${selC?.id===c.id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158]'}`}>
                  <span>{c.emoji}</span>{c.name}
                </button>)}
              </div>
            )}
            {page && <Alert type="green">📘 יפורסם ל: <strong>{page.name}</strong></Alert>}
          </Card>

          {/* ── SECONDARY: צור מאפס (collapsed when approved ads exist) ── */}
          <Card className="mb-3">
            {hasApproved ? (
              <button
                onClick={() => setScratchOpen(o => !o)}
                className="w-full flex items-center justify-between text-right"
              >
                <span className="text-[11px] font-bold tracking-wide text-[#6B8FA8]">✍️ צור מאפס</span>
                <span className="text-[11px] text-[#2E4459]">{scratchExpanded ? 'הסתר ▲' : 'הצג ▼'}</span>
              </button>
            ) : (
              <CardLabel>✍️ צור מאפס — בריף לAI</CardLabel>
            )}
            {scratchExpanded && (
              <div className={hasApproved ? 'mt-3' : ''}>
                <Textarea value={brief} onChange={setBrief} placeholder="תאר מה לפרסם..." rows={2} />
                <Btn variant="ghost" size="sm" loading={genLoading} onClick={genPost} disabled={!brief.trim()}>✨ צור עם AI</Btn>
              </div>
            )}
          </Card>

          <Card className="mb-3">
            <div className="flex items-center justify-between gap-2">
              <CardLabel>טקסט הפוסט</CardLabel>
              {fromApproval && (
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#34D399] mb-2">
                  נבחר מתוך המאושרות ✓
                  <button onClick={clearApprovedSelection} className="text-[#6B8FA8] hover:text-[#D9E8F5]" title="נתק מהמודעה המאושרת">✕</button>
                </span>
              )}
            </div>
            <Textarea value={text} onChange={setText} placeholder="כתוב פוסט..." rows={6} />
            <Input label="קישור / תמונה (אופציונלי)" value={link} onChange={setLink} placeholder="https://..." />
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
            {link.trim() && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(link.trim()) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={link.trim()} alt="" className="mt-3 w-full max-h-72 object-cover rounded-lg border border-[#1E2F42]" />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
