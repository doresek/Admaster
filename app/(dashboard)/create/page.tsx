'use client';
import { useState } from 'react';
import { Card, CardLabel, Chip, Textarea, Btn, OutputBox, Tabs, CopyBtn, CostBadge, Alert, PageHeader } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { FRAMEWORKS, FRAMEWORKS_BY_ID, type FrameworkId } from '@/lib/frameworks';
import { composeMasterPrompt, parseMasterResponse, isCriticalFailure, type MasterStudioOutput } from '@/lib/master-studio';
import { MARKETERS_BY_ID } from '@/lib/marketers';

const PLATFORMS = [
  { id: 'facebook',  l: 'Facebook',  i: '📘' },
  { id: 'instagram', l: 'Instagram', i: '📸' },
  { id: 'whatsapp',  l: 'WhatsApp',  i: '💬' },
  { id: 'tiktok',    l: 'TikTok',    i: '🎵' },
];
const TONES = ['חם ואישי','מקצועי','חסידי','דחיפות','סיפור'];
const TYPES = ['הצגת מוצר','מבצע','בניית אמון','שאלה לקהל','טיפ מקצועי'];
const HOOKS = ['שאלה פרובוקטיבית','עובדה מפתיעה','סיפור אישי','הצעה חסרת תחרות','אזהרה'];

const MASTER_NOTES_MAX = 2000;

export default function CreatePage() {
  const [plt,  setPlt]   = useState('facebook');
  const [tone, setTone]  = useState('חם ואישי');
  const [type, setType]  = useState('הצגת מוצר');

  // Override (optional)
  const [fwOverride,   setFwOverride]   = useState<FrameworkId | null>(null);
  const [hookOverride, setHookOverride] = useState<string | null>(null);

  const [brief,       setBrief]       = useState('');
  const [masterNotes, setMasterNotes] = useState('');

  const [tab,  setTab]   = useState('post');
  const [out,  setOut]   = useState<MasterStudioOutput | null>(null);
  const [revealOpen, setRevealOpen] = useState(true);

  const { call, loading, error } = useAI();
  const pLabel = PLATFORMS.find(p => p.id === plt)?.l ?? plt;

  async function generate() {
    if (!brief.trim()) return;
    const system = composeMasterPrompt({
      brief,
      platform:    pLabel,
      tone,
      type,
      framework:   fwOverride ?? undefined,
      hook:        hookOverride ?? undefined,
      masterNotes: masterNotes.slice(0, MASTER_NOTES_MAX),
    });
    const text = await call('master_post', system, `בריף: ${brief}`, 2500, plt);
    if (!text) return;
    const parsed = parseMasterResponse(text);
    if (isCriticalFailure(parsed)) {
      // Show as soft error — the API already deducted credits.
      // (Auto-refund is best implemented server-side in a follow-up.)
      console.warn('[create] critical tags missing in response');
    }
    setOut(parsed);
    setTab('post');
    setRevealOpen(true);
  }

  const TABS = [
    { id: 'post',     label: '📝 פוסט' },
    { id: 'wa',       label: '💬 WhatsApp' },
    { id: 'img',      label: '🖼 תמונה' },
    { id: 'hashtags', label: '# האשטגים' },
    { id: 'tips',     label: '💡 טיפים' },
  ];

  return (
    <div>
      <PageHeader eyebrow="יצירה" title="צור פוסט" sub="מבריף קצר לפוסט מקצועי"
        right={<CostBadge cost={4} />} />

      <div className="grid grid-cols-2 gap-4">
        {/* Left — settings */}
        <div>
          <Card className="mb-3">
            <CardLabel>פלטפורמה</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {PLATFORMS.map(p => <Chip key={p.id} label={`${p.i} ${p.l}`} active={plt===p.id} onClick={()=>setPlt(p.id)} />)}
            </div>
            <CardLabel>סוג פוסט</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {TYPES.map(t => <Chip key={t} label={t} active={type===t} onClick={()=>setType(t)} />)}
            </div>
            <CardLabel>טון</CardLabel>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map(t => <Chip key={t} label={t} active={tone===t} onClick={()=>setTone(t)} />)}
            </div>
          </Card>

          <Card className="mb-3">
            <CardLabel>בריף</CardLabel>
            <Textarea value={brief} onChange={setBrief}
              placeholder="תאר מה אתה רוצה לפרסם. לדוגמה: מבצע לחג שבועות — תפילין מהודרות 15% הנחה לבני מצווה..."
              rows={4} />
          </Card>

          <Card className="mb-3" style={{ borderColor: '#3D2F6B' }}>
            <CardLabel>🔒 הערות מאסטר (עדיפות עליונה)</CardLabel>
            <Textarea
              value={masterNotes}
              onChange={(v) => setMasterNotes(v.slice(0, MASTER_NOTES_MAX))}
              placeholder="הוראות שמועדפות על הכל. למשל: לא להזכיר מחיר, להדגיש את הסבא, להימנע ממילת 'מבצע'..."
              rows={3}
            />
            <div className="text-[10px] text-[#2E4459] mt-1 text-left" dir="ltr">
              {masterNotes.length} / {MASTER_NOTES_MAX}
            </div>
          </Card>

          <Btn variant="primary" full loading={loading} onClick={generate} disabled={!brief.trim()}>
            ✨ צור פוסט
          </Btn>
          {error && <Alert type="red" className="mt-3">❌ {error}</Alert>}
        </div>

        {/* Right — output */}
        <div>
          {out ? (
            <>
              <Tabs tabs={TABS} active={tab} onChange={setTab} />

              {tab === 'post' && (
                <>
                  <OutputBox text={out.post} />
                  <div className="flex gap-2 mt-2">
                    <CopyBtn text={out.post + '\n\n' + out.hashtags.join(' ')} />
                    <Btn variant="ghost" size="sm" onClick={generate} disabled={loading}>🔄 שוב</Btn>
                  </div>
                </>
              )}

              {tab === 'wa' && (
                <>
                  <OutputBox text={out.whatsapp} />
                  <CopyBtn text={out.whatsapp} className="mt-2" />
                </>
              )}

              {tab === 'img' && (
                <>
                  <Card className="bg-[#162030]">
                    <CardLabel>Prompt לIdeogram / Midjourney</CardLabel>
                    <div className="text-sm leading-relaxed" dir="ltr" style={{ textAlign: 'left' }}>{out.image}</div>
                  </Card>
                  <div className="flex gap-2 mt-2">
                    <CopyBtn text={out.image} label="📋 העתק prompt" />
                    <a href="https://ideogram.ai" target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#2A4158] text-[#6B8FA8] rounded-lg hover:border-[#0A7AFF] hover:text-[#3D9FFF] transition-colors">
                      🎨 Ideogram →
                    </a>
                  </div>
                </>
              )}

              {tab === 'hashtags' && (
                <div className="flex flex-wrap gap-2">
                  {out.hashtags.map((h, i) => (
                    <span key={i} className="bg-[#0A7AFF]/10 border border-[#0A7AFF]/20 text-[#3D9FFF] px-3 py-1 rounded-full text-sm font-medium">{h}</span>
                  ))}
                  <CopyBtn text={out.hashtags.join(' ')} className="mt-2 w-full" />
                </div>
              )}

              {tab === 'tips' && <OutputBox text={out.tips} className="text-sm" />}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <span className="text-4xl mb-3 opacity-30">✨</span>
              <span className="text-sm">מלא בריף ולחץ "צור פוסט"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
