'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardLabel, Input, Textarea, Select, Btn, Alert, PageHeader, Chip, CostBadge, Tabs } from '@/components/ui';
import { readActiveClientFromDocument } from '@/lib/active-client';
import type { Destination, DestinationType, TargetingSuggestion, AdInsights, AdAnalysis } from '@/types';
import { clsx } from 'clsx';

const VERDICT_LABEL: Record<string, { label: string; color: string }> = {
  winning:          { label: '🏆 מנצחת',        color: '#22C55E' },
  promising:        { label: '📈 מבטיחה',       color: '#3D9FFF' },
  underperforming:  { label: '⚠️ תת-ביצוע',     color: '#F59E0B' },
  too_early:        { label: '⏳ מוקדם מדי',     color: '#6B8FA8' },
};

const DESTINATIONS: { id: DestinationType; label: string; emoji: string; placeholder: string; hint: string }[] = [
  { id: 'landing_page', label: 'דף נחיתה שלנו', emoji: '🎯', placeholder: 'slug של הדף (לדוגמה: summer-sale)', hint: 'הקלד את ה-slug של דף הנחיתה שבנית' },
  { id: 'external_url',  label: 'URL חיצוני',    emoji: '🔗', placeholder: 'https://...', hint: 'כתובת אתר מלאה' },
  { id: 'whatsapp',      label: 'וואטסאפ',        emoji: '💬', placeholder: '9725XXXXXXXX', hint: 'מספר בפורמט בינלאומי (העמוד חייב וואטסאפ מחובר)' },
  { id: 'lead_form',     label: 'טופס לידים',     emoji: '📝', placeholder: 'lead_gen_form_id', hint: 'מזהה טופס לידים קיים ב-Meta' },
];

const CTAS = ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'GET_OFFER', 'CONTACT_US', 'BOOK_TRAVEL', 'WHATSAPP_MESSAGE'];

export default function AdsLauncherPage() {
  const [clientId, setClientId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [approved, setApproved] = useState<any[]>([]);
  const [picked, setPicked] = useState<any | null>(null);

  const [destType, setDestType] = useState<DestinationType>('landing_page');
  const [destValue, setDestValue] = useState('');
  const [headline, setHeadline] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [cta, setCta] = useState('LEARN_MORE');

  const [targeting, setTargeting] = useState<TargetingSuggestion | null>(null);
  const [budgetIls, setBudgetIls] = useState(70);

  const [previewHtml, setPreviewHtml] = useState('');
  const [result, setResult] = useState<any | null>(null);

  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');

  // Phase 2 — launched-ads tracking
  const [tab, setTab] = useState('new');
  const [launched, setLaunched] = useState<any[]>([]);
  const [insights, setInsights] = useState<Record<string, AdInsights>>({});
  const [analysis, setAnalysis] = useState<Record<string, AdAnalysis>>({});
  const [busyAd, setBusyAd] = useState<string | null>(null);

  // Which page + ad account this launch targets (token may have many — always explicit & visible).
  const [channels, setChannels] = useState<{ pages: { id: string; name: string }[]; adAccounts: { id: string; name: string }[] }>({ pages: [], adAccounts: [] });
  const [pageId, setPageId] = useState('');
  const [adAccountId, setAdAccountId] = useState('');

  const searchParams = useSearchParams();

  const [activeClient, setActiveClient] = useState<{ name: string; emoji: string } | null>(null);

  useEffect(() => { setClientId(readActiveClientFromDocument()); }, []);

  // Resolve the active client's name/emoji for the "ads for <client>" label.
  useEffect(() => {
    if (!clientId) { setActiveClient(null); return; }
    fetch('/api/active-client').then(r => r.json()).then(d => {
      const c = (d?.clients || []).find((x: any) => x.id === clientId);
      setActiveClient(c ? { name: c.name, emoji: c.emoji || '🏢' } : null);
    }).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/meta/channels?clientId=${clientId}`).then(r => r.json()).then(d => {
      if (d?.pages) {
        setChannels({ pages: d.pages, adAccounts: d.adAccounts || [] });
        setPageId(d.selectedPageId || (d.pages.length === 1 ? d.pages[0].id : ''));
        setAdAccountId(d.selectedAdAccountId || (d.adAccounts?.length === 1 ? d.adAccounts[0].id : ''));
      }
    }).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    if (tab === 'launched') fetch('/api/meta/launched').then(r => r.json()).then(d => setLaunched(Array.isArray(d) ? d : []));
  }, [tab]);

  async function analyzeAd(ad: any) {
    if (!clientId) { setError('בחר לקוח פעיל'); return; }
    setBusyAd(ad.id); setError('');
    try {
      const res = await fetch('/api/meta/ad-insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, launchedAdId: ad.id, analyze: true }),
      });
      const data = await res.json();
      if (data.insights) setInsights(m => ({ ...m, [ad.id]: data.insights }));
      if (data.analysis) setAnalysis(m => ({ ...m, [ad.id]: data.analysis }));
      if (!res.ok && !data.analysis) throw new Error(data.error || 'שגיאה בניתוח');
    } catch (e: any) { setError(e.message); }
    finally { setBusyAd(null); }
  }

  async function toggleStatus(ad: any) {
    if (!clientId) return;
    const next = ad.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setBusyAd(ad.id); setError('');
    try {
      const res = await fetch('/api/meta/ad-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, launchedAdId: ad.id, status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בשינוי סטטוס');
      setLaunched(list => list.map(x => x.id === ad.id ? { ...x, status: next } : x));
    } catch (e: any) { setError(e.message); }
    finally { setBusyAd(null); }
  }

  useEffect(() => {
    fetch('/api/approvals').then(r => r.json()).then((d: any[]) => {
      const list = Array.isArray(d) ? d.filter(a => a.status === 'approved') : [];
      setApproved(list);
      // Deep-link: ?approval=<id> preselects.
      const wanted = searchParams?.get('approval');
      if (wanted) { const m = list.find(a => a.id === wanted); if (m) selectApproval(m); }
    });
  }, [searchParams]);

  function selectApproval(a: any) {
    setPicked(a);
    setPrimaryText(a.content?.text || '');
    setHeadline(a.title || '');
    setError('');
    setStep(2);
  }

  async function suggestTargeting() {
    if (!clientId || !picked) return;
    setLoading(true); setStage('ה-AI בונה טרגוט…'); setError('');
    try {
      const res = await fetch('/api/meta/targeting', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, approvalId: picked.id, pageId, adAccountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בהצעת טרגוט');
      setTargeting(data.suggestion);
      setBudgetIls(Math.round((data.suggestion.dailyBudget || 7000) / 100));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setStage(''); }
  }

  function destination(): Destination { return { type: destType, value: destValue.trim() }; }

  async function doPreview() {
    if (!clientId || !picked || !destValue.trim()) { setError('בחר יעד ומלא את הערך שלו'); return; }
    setLoading(true); setStage('בונה תצוגה מקדימה ב-Meta…'); setError('');
    try {
      const res = await fetch('/api/meta/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, approvalId: picked.id, headline, primaryText, cta, destination: destination(), pageId, adAccountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בתצוגה מקדימה');
      setPreviewHtml(data.previewHtml);
      setStep(3);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setStage(''); }
  }

  async function doLaunch() {
    if (!clientId || !picked || !targeting) { setError('חסר טרגוט — חזור ולחץ "הצע טרגוט"'); return; }
    setLoading(true); setStage('משיק את הקמפיין ב-Meta (PAUSED)…'); setError('');
    try {
      const res = await fetch('/api/meta/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          clientId, approvalId: picked.id, headline, primaryText, cta,
          destination: destination(),
          targeting: { ...targeting, dailyBudget: Math.round(budgetIls * 100) },
          budget: Math.round(budgetIls * 100),
          campaignName: headline || picked.title || undefined,
          pageId, adAccountId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.refunded ? `${data.error} — ${data.refunded}⚡ הוחזרו` : data.error || 'שגיאה בהשקה');
      }
      setResult(data); setStep(4);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setStage(''); }
  }

  async function activate() {
    if (!clientId || !result?.launchedAdId) return;
    setLoading(true); setStage('מפעיל את הקמפיין…'); setError('');
    try {
      const res = await fetch('/api/meta/ad-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, launchedAdId: result.launchedAdId, status: 'ACTIVE' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בהפעלה');
      setResult({ ...result, status: 'ACTIVE' });
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setStage(''); }
  }

  const destMeta = DESTINATIONS.find(d => d.id === destType)!;

  return (
    <div>
      <PageHeader eyebrow="Meta Ads" title="משגר מודעות" sub="ממודעה מאושרת → קמפיין פייסבוק חי — הכל מ-AdMaster"
        right={<CostBadge cost={15} />} />

      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'new', label: '🚀 השקה חדשה' }, { id: 'launched', label: '📊 מודעות שהושקו' }]} />

      {!clientId && <Alert type="amber" className="mb-3">בחר לקוח פעיל בראש המסך כדי להשיק מודעות.</Alert>}
      {error && <Alert type="red" className="mb-3">❌ {error}</Alert>}

      {/* Step 1 — pick approved ad (filtered to the active client) */}
      {tab === 'new' && step === 1 && (
        <Card>
          <CardLabel>
            1 · בחר מודעה מאושרת{activeClient ? ` עבור ${activeClient.emoji} ${activeClient.name}` : ''}
          </CardLabel>
          {(() => {
            const myAds = clientId ? approved.filter(a => a.client_id === clientId) : [];
            if (!clientId) return <div className="text-sm text-[#6B8FA8] py-6 text-center">בחר לקוח פעיל בראש המסך.</div>;
            if (myAds.length === 0) return (
              <div className="text-sm text-[#6B8FA8] py-6 text-center">
                אין מודעות מאושרות ללקוח הזה. צור מודעה, שלח לאישור הלקוח, ואז חזור לכאן.
              </div>
            );
            return (
              <div className="grid grid-cols-2 gap-3 mt-2">
                {myAds.map(a => (
                  <button key={a.id} onClick={() => selectApproval(a)}
                    className="text-right border border-[#1E2F42] bg-[#162030] rounded-lg p-3 hover:border-[#0A7AFF] transition-all">
                    {a.content?.image_url && <img src={a.content.image_url} alt="" className="w-full h-28 object-cover rounded mb-2" />}
                    <div className="text-xs font-bold text-[#D9E8F5] mb-1">{a.title || 'מודעה מאושרת'}</div>
                    {activeClient && <div className="text-[10px] text-[#3D9FFF] mb-1">{activeClient.emoji} {activeClient.name}</div>}
                    <div className="text-[11px] text-[#6B8FA8] line-clamp-3">{a.content?.text}</div>
                  </button>
                ))}
              </div>
            );
          })()}
        </Card>
      )}

      {/* Step 2 — destination + targeting + creative */}
      {tab === 'new' && step === 2 && picked && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardLabel>2 · מפרסם דרך</CardLabel>
            <div className="text-[10px] text-[#6B8FA8] mb-2">ודא שזה העמוד וחשבון המודעות הנכונים ללקוח הזה.</div>
            <div className="grid grid-cols-1 gap-2 mb-2">
              <div>
                <div className="text-[10px] text-[#6B8FA8] mb-1">📘 עמוד פייסבוק</div>
                <Select value={pageId} onChange={setPageId}
                  options={[{ value: '', label: '— בחר עמוד —' }, ...channels.pages.map(p => ({ value: p.id, label: p.name }))]} />
              </div>
              <div>
                <div className="text-[10px] text-[#6B8FA8] mb-1">💰 חשבון מודעות</div>
                <Select value={adAccountId} onChange={setAdAccountId}
                  options={[{ value: '', label: '— בחר חשבון —' }, ...channels.adAccounts.map(a => ({ value: a.id, label: a.name }))]} />
              </div>
              {(!pageId || !adAccountId) && (
                <div className="text-[10px] text-amber-400">⚠️ בחר עמוד וחשבון מודעות לפני המשך.</div>
              )}
            </div>

            <CardLabel>יעד המודעה</CardLabel>
            <div className="grid grid-cols-2 gap-2 my-2">
              {DESTINATIONS.map(d => (
                <button key={d.id} onClick={() => { setDestType(d.id); setCta(d.id === 'whatsapp' ? 'WHATSAPP_MESSAGE' : d.id === 'lead_form' ? 'SIGN_UP' : 'LEARN_MORE'); }}
                  className={clsx('p-2.5 rounded-lg border text-xs font-bold transition-all',
                    destType === d.id ? 'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]' : 'border-[#1E2F42] bg-[#162030] text-[#6B8FA8]')}>
                  <span className="mr-1">{d.emoji}</span>{d.label}
                </button>
              ))}
            </div>
            <Input value={destValue} onChange={setDestValue} placeholder={destMeta.placeholder} />
            <div className="text-[10px] text-[#6B8FA8] mt-1">{destMeta.hint}</div>

            <div className="mt-4"><CardLabel>קריאייטיב</CardLabel></div>
            <Input value={headline} onChange={setHeadline} placeholder="כותרת המודעה" />
            <Textarea value={primaryText} onChange={setPrimaryText} placeholder="טקסט ראשי" rows={4} />
            <Select value={cta} onChange={setCta} options={CTAS.map(c => ({ value: c, label: c }))} />
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <CardLabel>טרגוט + תקציב</CardLabel>
              <Btn variant="ghost" size="sm" loading={loading} onClick={suggestTargeting}>🤖 הצע טרגוט (2⚡)</Btn>
            </div>
            {!targeting ? (
              <div className="text-sm text-[#6B8FA8] py-6 text-center">לחץ "הצע טרגוט" כדי שה-AI יבנה קהל + תקציב, או הגדר ידנית.</div>
            ) : (
              <div className="mt-2 space-y-3">
                <div className="text-[11px] text-[#6B8FA8] leading-relaxed bg-[#0A7AFF]/5 border border-[#0A7AFF]/20 rounded p-2">{targeting.rationale}</div>
                <div className="grid grid-cols-3 gap-2">
                  <div><div className="text-[10px] text-[#6B8FA8] mb-1">גיל מ-</div><Input value={String(targeting.ageMin)} onChange={v => setTargeting({ ...targeting, ageMin: Number(v) || 18 })} /></div>
                  <div><div className="text-[10px] text-[#6B8FA8] mb-1">גיל עד</div><Input value={String(targeting.ageMax)} onChange={v => setTargeting({ ...targeting, ageMax: Number(v) || 65 })} /></div>
                  <div><div className="text-[10px] text-[#6B8FA8] mb-1">מגדר</div>
                    <Select value={targeting.genders} onChange={v => setTargeting({ ...targeting, genders: v as any })}
                      options={[{ value: 'all', label: 'הכל' }, { value: 'male', label: 'גברים' }, { value: 'female', label: 'נשים' }]} />
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#6B8FA8] mb-1">תחומי עניין</div>
                  <div className="flex flex-wrap gap-1.5">
                    {targeting.interests.length ? targeting.interests.map((i, idx) => (
                      <Chip key={idx} label={i.name + (!i.id ? ' ⚠️' : '')} />
                    )) : <span className="text-[11px] text-[#2E4459]">אין (ירחיב את הקהל)</span>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#6B8FA8] mb-1">תקציב יומי (₪)</div>
                  <Input value={String(budgetIls)} onChange={v => setBudgetIls(Number(v) || 0)} />
                </div>
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <Btn variant="ghost" size="sm" onClick={() => setStep(1)}>← חזרה</Btn>
              <Btn variant="primary" full loading={loading} onClick={doPreview} disabled={!destValue.trim() || !pageId || !adAccountId}>תצוגה מקדימה →</Btn>
            </div>
          </Card>
        </div>
      )}

      {/* Step 3 — preview */}
      {tab === 'new' && step === 3 && (
        <Card>
          <CardLabel>3 · תצוגה מקדימה מ-Meta</CardLabel>
          {/* previewHtml is the <iframe> returned by Meta's /generatepreviews Graph endpoint
              (first-party, fetched server-side with the client's own token). It is intentionally
              an iframe to facebook.com — sanitizing would strip it and break the preview. */}
          <div className="my-3 rounded-lg overflow-hidden border border-[#2A4158] bg-white flex justify-center"
            dangerouslySetInnerHTML={{ __html: previewHtml }} />
          <div className="flex gap-2">
            <Btn variant="ghost" size="sm" onClick={() => setStep(2)}>← ערוך</Btn>
            <Btn variant="primary" full loading={loading} onClick={doLaunch}>✅ אשר והשק (PAUSED) · 15⚡</Btn>
          </div>
        </Card>
      )}

      {/* Step 4 — launched */}
      {tab === 'new' && step === 4 && result && (
        <Card>
          <div className="text-center py-4">
            <div className="text-3xl mb-2">🎉</div>
            <div className="text-lg font-bold text-[#D9E8F5] mb-1">הקמפיין נוצר ב-Meta</div>
            <div className="text-sm text-[#6B8FA8] mb-4">
              סטטוס: <span className={result.status === 'ACTIVE' ? 'text-green-400' : 'text-amber-400'}>{result.status === 'ACTIVE' ? 'פעיל' : 'מושהה (לבדיקה)'}</span>
            </div>
            <div className="flex gap-2 justify-center">
              {result.status !== 'ACTIVE' && (
                <Btn variant="primary" loading={loading} onClick={activate}>▶️ הפעל עכשיו</Btn>
              )}
              <a href={result.adsManagerUrl} target="_blank" rel="noreferrer"
                className="px-4 py-2.5 border border-[#2A4158] rounded-lg text-sm font-semibold text-[#D9E8F5] hover:border-[#0A7AFF]">
                פתח ב-Ads Manager ↗
              </a>
              <Btn variant="ghost" onClick={() => { setStep(1); setPicked(null); setResult(null); setTargeting(null); setDestValue(''); setPreviewHtml(''); }}>מודעה נוספת</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* Launched-ads tracking + AI analysis */}
      {tab === 'launched' && (
        <div>
          {launched.length === 0 ? (
            <Card><div className="text-sm text-[#6B8FA8] py-6 text-center">עדיין לא הושקו מודעות. השק אחת מהטאב "השקה חדשה".</div></Card>
          ) : (
            <div className="space-y-3">
              {launched.map(ad => {
                const ins = insights[ad.id]; const an = analysis[ad.id];
                const v = an ? VERDICT_LABEL[an.verdict] : null;
                return (
                  <Card key={ad.id}>
                    <div className="flex items-start gap-3">
                      {ad.image_url && <img src={ad.image_url} alt="" className="w-16 h-16 rounded object-cover" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#D9E8F5] truncate">{ad.headline || 'מודעה'}</span>
                          <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full',
                            ad.status === 'ACTIVE' ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400')}>
                            {ad.status === 'ACTIVE' ? 'פעיל' : 'מושהה'}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#6B8FA8] truncate mt-0.5">{ad.primary_text}</div>
                      </div>
                      <div className="flex flex-col gap-1.5 items-end shrink-0">
                        <Btn variant="ghost" size="xs" loading={busyAd === ad.id} onClick={() => toggleStatus(ad)}>
                          {ad.status === 'ACTIVE' ? '⏸ השהה' : '▶️ הפעל'}
                        </Btn>
                        <Btn variant="ghost" size="xs" loading={busyAd === ad.id} onClick={() => analyzeAd(ad)}>📊 נתח (2⚡)</Btn>
                      </div>
                    </div>

                    {ins && (
                      <div className="grid grid-cols-4 gap-2 mt-3">
                        {[
                          ['חשיפות', ins.impressions], ['קליקים', ins.clicks],
                          ['CTR', `${ins.ctr.toFixed(2)}%`], ['הוצאה', `₪${ins.spend.toFixed(0)}`],
                          ['תוצאות', ins.results], ['עלות/תוצאה', ins.costPerResult != null ? `₪${ins.costPerResult.toFixed(1)}` : '—'],
                          ['CPC', `₪${ins.cpc.toFixed(2)}`], ['CPM', `₪${ins.cpm.toFixed(1)}`],
                        ].map(([label, val], i) => (
                          <div key={i} className="bg-[#111A24] border border-[#1E2F42] rounded-lg p-2 text-center">
                            <div className="text-[9px] text-[#6B8FA8] uppercase tracking-wide">{label}</div>
                            <div className="text-sm font-bold text-[#D9E8F5]">{val}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {an && (
                      <div className="mt-3 border-t border-[#1E2F42] pt-3">
                        {v && <div className="text-xs font-bold mb-1" style={{ color: v.color }}>{v.label}</div>}
                        <div className="text-[11px] text-[#6B8FA8] leading-relaxed mb-2">{an.summary}</div>
                        <div className="space-y-1.5">
                          {an.recommendations.map((r, i) => (
                            <div key={i} className="text-[11px] bg-[#0A7AFF]/5 border border-[#0A7AFF]/20 rounded p-2">
                              <span className="font-bold text-[#3D9FFF]">{r.title}</span>
                              <span className="text-[#6B8FA8]"> — {r.why}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {loading && stage && (
        <div className="mt-3 flex items-center gap-3 text-sm text-[#6B8FA8]">
          <div className="w-4 h-4 border-2 border-[#0A7AFF]/20 border-t-[#0A7AFF] rounded-full animate-spin" />{stage}
        </div>
      )}
    </div>
  );
}
