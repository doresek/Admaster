'use client';
import { useState } from 'react';
import { Card, CardLabel, Chip, Textarea, Btn, OutputBox, Tabs, CopyBtn, CostBadge, Alert, PageHeader } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { FRAMEWORKS, FRAMEWORKS_BY_ID, type FrameworkId } from '@/lib/frameworks';
import { composeMasterPrompt, parseMasterResponse, isCriticalFailure, type MasterStudioOutput } from '@/lib/master-studio';

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

            <div className="border-t border-[#1E2F42] pt-3 mt-3">
              <CardLabel>🎛 Override (אופציונלי)</CardLabel>
              <div className="text-[11px] text-[#2E4459] mb-2">
                כברירת מחדל — ה-AI בוחר את ה-framework וה-hook. לחץ chip לכפיית בחירה.
              </div>

              <div className="text-[11px] text-[#6B8FA8] mb-1">Framework</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Chip label="— AI יבחר —" active={fwOverride===null} onClick={() => setFwOverride(null)} />
                {FRAMEWORKS.map(f => (
                  <Chip
                    key={f.id}
                    label={`${f.emoji} ${f.name_he.split('—')[0].trim()}`}
                    active={fwOverride===f.id}
                    onClick={() => setFwOverride(fwOverride === f.id ? null : f.id)}
                  />
                ))}
              </div>
              {fwOverride && (
                <div className="text-[10px] text-[#6B8FA8] bg-[#162030] rounded-lg px-3 py-2 mb-3 leading-relaxed">
                  <strong className="text-[#D9E8F5]">{FRAMEWORKS_BY_ID[fwOverride].name_en}:</strong> {FRAMEWORKS_BY_ID[fwOverride].description}
                </div>
              )}

              <div className="text-[11px] text-[#6B8FA8] mb-1">Hook</div>
              <div className="flex flex-wrap gap-1.5">
                <Chip label="— AI יבחר —" active={hookOverride===null} onClick={() => setHookOverride(null)} />
                {HOOKS.map(h => (
                  <Chip
                    key={h}
                    label={h}
                    active={hookOverride===h}
                    onClick={() => setHookOverride(hookOverride === h ? null : h)}
                  />
                ))}
              </div>
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
              {(out.avatar || out.marketer) && (
                <Card className="mb-3" style={{ borderColor: '#2A3E66' }}>
                  <button
                    onClick={() => setRevealOpen(o => !o)}
                    className="w-full flex items-center justify-between text-right"
                  >
                    <span className="text-[13px] font-semibold text-[#D9E8F5] flex items-center gap-2">
                      🧠 Why this works
                    </span>
                    <span className="text-[#6B8FA8] text-xs">{revealOpen ? '▾' : '▸'}</span>
                  </button>

                  {revealOpen && (
                    <div className="mt-3 space-y-3 text-[12px] leading-relaxed">
                      {out.avatar && (
                        <div>
                          <div className="text-[11px] font-bold text-[#6B8FA8] uppercase tracking-wider mb-1">👤 אווטאר</div>
                          <div className="space-y-0.5 text-[#D9E8F5]">
                            {out.avatar.persona         && <div><span className="text-[#6B8FA8]">פרסונה:</span> {out.avatar.persona}</div>}
                            {out.avatar.fears           && <div><span className="text-[#6B8FA8]">פחדים:</span> {out.avatar.fears}</div>}
                            {out.avatar.desires         && <div><span className="text-[#6B8FA8]">רצונות:</span> {out.avatar.desires}</div>}
                            {out.avatar.awareness_level && <div><span className="text-[#6B8FA8]">Awareness:</span> {out.avatar.awareness_level}</div>}
                            {out.avatar.objections      && <div><span className="text-[#6B8FA8]">התנגדויות:</span> {out.avatar.objections}</div>}
                          </div>
                        </div>
                      )}

                      {out.marketer && (
                        <div className="border-t border-[#1E2F42] pt-2">
                          <div className="text-[11px] font-bold text-[#6B8FA8] uppercase tracking-wider mb-1">🎯 משווק נבחר</div>
                          <div className="text-[#D9E8F5] flex items-center gap-2">
                            <span className="text-lg">{out.marketer.emoji}</span>
                            <span className="font-semibold">{out.marketer.name}</span>
                          </div>
                          {out.why && <div className="text-[#6B8FA8] mt-1">{out.why}</div>}
                        </div>
                      )}

                      {out.principles.length > 0 && (
                        <div className="border-t border-[#1E2F42] pt-2">
                          <div className="text-[11px] font-bold text-[#6B8FA8] uppercase tracking-wider mb-1">📚 עקרונות שיושמו</div>
                          <ul className="space-y-1 text-[#D9E8F5]">
                            {out.principles.map((p, i) => (
                              <li key={i}>
                                <span className="font-semibold text-[#3D9FFF]">{p.principle}</span>
                                {p.application && <span className="text-[#6B8FA8]"> → {p.application}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}

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
