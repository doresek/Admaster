'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Chip, Textarea, Input, Btn, OutputBox, CopyBtn, CostBadge, Alert, PageHeader, Tabs } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { FRAMEWORKS, FRAMEWORKS_BY_ID, type FrameworkId } from '@/lib/frameworks';
import type { MetaClient, CreditAction } from '@/types';

type Channel = 'email' | 'sms' | 'whatsapp';

const CHANNELS: { id: Channel; emoji: string; label: string; max: number; action: CreditAction }[] = [
  { id:'email',    emoji:'📧', label:'Email',    max: 6000, action: 'email' },
  { id:'whatsapp', emoji:'💬', label:'WhatsApp', max: 1000, action: 'post' },
  { id:'sms',      emoji:'📱', label:'SMS',      max: 160,  action: 'sms' },
];

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

export default function MessagesPage() {
  const [clients,  setClients]  = useState<MetaClient[]>([]);
  const [selC,     setSelC]     = useState<MetaClient|null>(null);
  const [channel,  setChannel]  = useState<Channel>('email');
  const [fw,       setFw]       = useState<FrameworkId>('aida');
  const [brief,    setBrief]    = useState('');
  const [output,   setOutput]   = useState<{ subject: string; body: string; cta: string } | null>(null);
  const [tab,      setTab]      = useState('compose');
  const [history,  setHistory]  = useState<any[]>([]);
  const [saved,    setSaved]    = useState(false);
  const { call, loading, error } = useAI();

  const supabase = createClient();
  const ch = CHANNELS.find(c => c.id === channel)!;
  const fwObj = FRAMEWORKS_BY_ID[fw];

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('meta_clients').select('*').eq('user_id', user.id)
        .then(({ data }) => setClients(data ?? []));
      supabase.from('messages').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
        .then(({ data }) => setHistory(data ?? []));
    });
  }, []);

  async function generate() {
    if (!brief.trim()) return;
    setOutput(null); setSaved(false);

    const constraintByCh: Record<Channel, string> = {
      email:    `אורך גוף ההודעה: 200-600 מילים. החזר גם נושא אימייל קצר (עד 60 תווים).`,
      whatsapp: `אורך גוף ההודעה: עד 300 מילים. כתוב טבעי לצ'אט, בלי אמוג'ים מוגזמים. בלי נושא.`,
      sms:      `אורך הודעה מקסימלי: 160 תווים בלבד. בלי אמוג'ים. בלי נושא. ישיר ומהיר.`,
    };

    const system = `אתה קופירייטר ${ch.label}. ייעודי לקהל ${selC?.industry ?? 'כללי'}.

${fwObj.prompt}

${constraintByCh[channel]}

החזר בפורמט זה בלבד:
${channel === 'email' ? '[SUBJECT]נושא האימייל[/SUBJECT]\n' : ''}[BODY]גוף ההודעה[/BODY]
[CTA]קריאה לפעולה אחת חדה[/CTA]`;

    const text = await call(ch.action, system, brief, channel === 'email' ? 1800 : 800, channel);
    if (!text) return;

    const result = {
      subject: channel === 'email' ? xt(text, 'SUBJECT') : '',
      body:    xt(text, 'BODY'),
      cta:     xt(text, 'CTA'),
    };
    setOutput(result);

    // Save to messages table
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from('messages').insert({
        user_id:   user.id,
        client_id: selC?.id ?? null,
        channel,
        framework: fw,
        subject:   result.subject || null,
        body:      result.body,
        cta:       result.cta,
        meta:      { brief },
      }).select().single();
      if (data) {
        setHistory(p => [data, ...p]);
        setSaved(true);
      }
    }
  }

  const bodyChars = output?.body?.length ?? 0;
  const tooLong = bodyChars > ch.max;

  return (
    <div>
      <PageHeader
        eyebrow="Messages"
        title="כתיבה רב-ערוצית"
        sub="Email · WhatsApp · SMS — עם framework ומגבלות לכל ערוץ"
        right={<CostBadge cost={ch.id === 'sms' ? 2 : 3} />}
      />

      <Tabs tabs={[{id:'compose',label:'✍️ כתיבה'},{id:'history',label:`📜 היסטוריה (${history.length})`}]} active={tab} onChange={setTab} />

      {tab === 'compose' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Card className="mb-3">
              <CardLabel>ערוץ</CardLabel>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {CHANNELS.map(c => (
                  <Chip key={c.id} label={`${c.emoji} ${c.label}`} active={channel===c.id} onClick={() => setChannel(c.id)} />
                ))}
              </div>
              <div className="text-[11px] text-[#6B8FA8] bg-[#162030] rounded-lg px-3 py-2">
                מגבלת אורך: <strong className="text-[#D9E8F5]">{ch.max.toLocaleString()}</strong> תווים
              </div>
            </Card>

            <Card className="mb-3">
              <CardLabel>Framework</CardLabel>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {FRAMEWORKS.map(f => (
                  <Chip key={f.id} label={`${f.emoji} ${f.name_he.split('—')[0].trim()}`} active={fw===f.id} onClick={()=>setFw(f.id)} />
                ))}
              </div>
              <div className="text-[11px] text-[#6B8FA8] bg-[#162030] rounded-lg px-3 py-2">
                {fwObj.description}
              </div>
            </Card>

            {clients.length > 0 && (
              <Card className="mb-3">
                <CardLabel>לקוח (אופציונלי)</CardLabel>
                <div className="flex flex-wrap gap-2">
                  <Chip label="ללא" active={!selC} onClick={() => setSelC(null)} />
                  {clients.map(c => (
                    <Chip key={c.id} label={`${c.emoji} ${c.name}`} active={selC?.id===c.id} onClick={() => setSelC(c)} />
                  ))}
                </div>
              </Card>
            )}

            <Card className="mb-3">
              <CardLabel>בריף</CardLabel>
              <Textarea value={brief} onChange={setBrief} placeholder="תאר מה לכתוב — מוצר, הצעה, קהל יעד..." rows={5} />
            </Card>

            <Btn variant="primary" full loading={loading} onClick={generate} disabled={!brief.trim()}>
              {ch.emoji} צור הודעת {ch.label}
            </Btn>
            {error && <Alert type="red">❌ {error}</Alert>}
            {saved && <Alert type="green">✅ נשמר בהיסטוריה</Alert>}
          </div>

          <div>
            {output ? (
              <>
                {output.subject && (
                  <Card className="mb-3">
                    <CardLabel>📨 נושא</CardLabel>
                    <div className="text-base font-semibold text-[#D9E8F5]">{output.subject}</div>
                    <div className="mt-2"><CopyBtn text={output.subject} label="📋 העתק נושא" /></div>
                  </Card>
                )}
                <Card className="mb-2" style={tooLong ? { borderColor: 'rgba(220,38,38,.4)' } : undefined}>
                  <div className="flex items-center justify-between mb-2">
                    <CardLabel>{ch.emoji} גוף ההודעה</CardLabel>
                    <span className={`text-[10px] font-mono ${tooLong ? 'text-red-400' : 'text-[#6B8FA8]'}`}>
                      {bodyChars.toLocaleString()} / {ch.max.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-[#D9E8F5]">{output.body}</div>
                  <div className="mt-3 flex gap-2"><CopyBtn text={output.body} /></div>
                  {tooLong && <Alert type="amber">⚠️ ההודעה חורגת מהמגבלה של {ch.label}</Alert>}
                </Card>
                {output.cta && (
                  <Card style={{ borderColor: 'rgba(217,119,6,.3)' }}>
                    <CardLabel>📣 CTA</CardLabel>
                    <div className="font-bold text-base text-[#D97706]">{output.cta}</div>
                  </Card>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
                <span className="text-5xl mb-3 opacity-30">{ch.emoji}</span>
                <span className="text-sm">הזן בריף ולחץ "צור הודעה"</span>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div>
          {history.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <div className="text-4xl mb-3 opacity-30">📭</div>
              <div className="text-sm">אין הודעות עדיין</div>
            </div>
          ) : (
            history.map(m => {
              const cInfo = CHANNELS.find(c => c.id === m.channel);
              return (
                <div key={m.id} className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{cInfo?.emoji}</span>
                      <span className="text-sm font-medium">{cInfo?.label}</span>
                      {m.framework && (
                        <span className="text-[10px] bg-[#1D2D3E] text-[#6B8FA8] px-2 py-0.5 rounded-full">{m.framework.toUpperCase()}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#2E4459]">{new Date(m.created_at).toLocaleDateString('he')}</span>
                  </div>
                  {m.subject && <div className="text-sm font-semibold text-[#D9E8F5] mb-1">{m.subject}</div>}
                  <div className="text-[13px] text-[#6B8FA8] leading-relaxed whitespace-pre-wrap line-clamp-4">{m.body}</div>
                  {m.cta && <div className="text-xs text-[#D97706] mt-2">📣 {m.cta}</div>}
                  <div className="mt-2 flex gap-2"><CopyBtn text={m.body} /></div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
