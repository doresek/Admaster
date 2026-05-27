'use client';
import { useState } from 'react';
import { Card, CardLabel, Chip, Textarea, Btn, OutputBox, Tabs, CopyBtn, CostBadge, Alert, PageHeader } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { FRAMEWORKS, FRAMEWORKS_BY_ID, composeSystemPrompt, type FrameworkId } from '@/lib/frameworks';

const PLATFORMS = [{ id:'facebook',l:'Facebook',i:'📘'},{id:'instagram',l:'Instagram',i:'📸'},{id:'whatsapp',l:'WhatsApp',i:'💬'},{id:'tiktok',l:'TikTok',i:'🎵'}];
const TONES     = ['חם ואישי','מקצועי','חסידי','דחיפות','סיפור'];
const TYPES     = ['הצגת מוצר','מבצע','בניית אמון','שאלה לקהל','טיפ מקצועי'];
const HOOKS     = ['שאלה פרובוקטיבית','עובדה מפתיעה','סיפור אישי','הצעה חסרת תחרות','אזהרה'];

function xt(raw: string, t: string) {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
}

export default function CreatePage() {
  const [plt,  setPlt]   = useState('facebook');
  const [tone, setTone]  = useState('חם ואישי');
  const [type, setType]  = useState('הצגת מוצר');
  const [hook, setHook]  = useState('שאלה פרובוקטיבית');
  const [fw,   setFw]    = useState<FrameworkId>('pas');
  const [brief, setBrief] = useState('');
  const [tab,  setTab]   = useState('post');
  const [out,  setOut]   = useState<{ post:string; hashtags:string[]; img:string; tips:string; wa:string } | null>(null);

  const { call, loading, error } = useAI();
  const pLabel = PLATFORMS.find(p => p.id === plt)?.l ?? plt;
  const fwObj  = FRAMEWORKS_BY_ID[fw];

  async function generate() {
    if (!brief.trim()) return;
    const system = composeSystemPrompt({ framework: fw, platform: pLabel, tone, type, hook });
    const text = await call('post', system, `בריף: ${brief}`, 1200, plt);
    if (!text) return;

    setOut({
      post:     xt(text, 'POST'),
      hashtags: xt(text, 'HASHTAGS').split(/\s+/).filter(h => h.startsWith('#')),
      img:      xt(text, 'IMAGE_PROMPT'),
      tips:     xt(text, 'TIPS'),
      wa:       xt(text, 'WHATSAPP'),
    });
    setTab('post');
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
        right={<CostBadge cost={3} />} />

      <div className="grid grid-cols-2 gap-4">
        {/* Left — settings */}
        <div>
          <Card className="mb-3">
            <CardLabel>Framework קופירייטינג</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {FRAMEWORKS.map(f => (
                <Chip key={f.id} label={`${f.emoji} ${f.name_he.split('—')[0].trim()}`} active={fw===f.id} onClick={()=>setFw(f.id)} />
              ))}
            </div>
            <div className="text-[11px] text-[#6B8FA8] bg-[#162030] rounded-lg px-3 py-2 mb-4 leading-relaxed">
              <strong className="text-[#D9E8F5]">{fwObj.name_en}:</strong> {fwObj.description}
              <div className="mt-1 text-[10px] text-[#2E4459]">מבנה: {fwObj.structure.join(' → ')}</div>
            </div>

            <CardLabel>פלטפורמה</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {PLATFORMS.map(p => <Chip key={p.id} label={`${p.i} ${p.l}`} active={plt===p.id} onClick={()=>setPlt(p.id)} />)}
            </div>
            <CardLabel>סוג פוסט</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {TYPES.map(t => <Chip key={t} label={t} active={type===t} onClick={()=>setType(t)} />)}
            </div>
            <CardLabel>Hook</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {HOOKS.map(h => <Chip key={h} label={h} active={hook===h} onClick={()=>setHook(h)} />)}
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
                  <OutputBox text={out.wa} />
                  <CopyBtn text={out.wa} className="mt-2" />
                </>
              )}

              {tab === 'img' && (
                <>
                  <Card className="bg-[#162030]">
                    <CardLabel>Prompt לIdeogram / Midjourney</CardLabel>
                    <div className="text-sm leading-relaxed" dir="ltr" style={{ textAlign: 'left' }}>{out.img}</div>
                  </Card>
                  <div className="flex gap-2 mt-2">
                    <CopyBtn text={out.img} label="📋 העתק prompt" />
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
