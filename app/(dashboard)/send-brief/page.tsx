'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Btn, Alert, PageHeader, CopyBtn, Select } from '@/components/ui';
import { useMetaClients } from '@/lib/hooks/useMetaClients';
import { briefLink, whatsappShareLink } from '@/lib/share';

type BriefCode = { code: string; token: string | null };

const WA_MSG = (link: string) =>
  `היי! כדי שנבנה לך מודעות שמביאות תוצאות, מלא בבקשה את הבריף הקצר הזה (כ-5 דקות):\n\n${link}`;

export default function SendBriefPage() {
  const [codes,    setCodes]    = useState<BriefCode[]>([]);
  const [newCode,  setNewCode]  = useState<BriefCode | null>(null);
  const [clientId, setClientId] = useState('');
  const clients = useMetaClients();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('brief_codes').select('code, token').eq('user_id', user.id)
        .then(({ data }) => setCodes((data as BriefCode[]) ?? []));
    });
  }, []);

  async function create() {
    if (!clientId) return;
    const res = await fetch('/api/briefs/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    });
    if (!res.ok) return;
    const { code, token } = await res.json() as { code: string; token: string };
    const created = { code, token };
    setCodes(p => [...p, created]);
    setNewCode(created);
    if (token) navigator.clipboard.writeText(briefLink(token));
  }

  return (
    <div>
      <PageHeader eyebrow="שיתוף" title="שלח בריף ללקוח"
        sub="הלקוח ממלא → אתה מקבל אווטאר + מודעות + משפך"
        right={<Btn variant="primary" onClick={create} disabled={!clientId}>+ צור קישור חדש</Btn>} />

      <Card className="mb-4">
        <CardLabel>לאיזה לקוח הבריף?</CardLabel>
        {clients.length === 0 ? (
          <Alert type="amber">
            אין לקוחות שמורים — <a href="/clients" className="underline">הוסף לקוח</a> כדי ליצור קישור בריף
          </Alert>
        ) : (
          <Select
            value={clientId}
            onChange={setClientId}
            options={[
              { value: '', label: '— בחר לקוח —' },
              ...clients.map(c => ({ value: c.id, label: `${c.emoji ?? ''} ${c.name}` })),
            ]}
          />
        )}
      </Card>

      {newCode && newCode.token && (
        <Card className="mb-4" style={{ borderColor: 'rgba(184,149,58,.3)' }}>
          <CardLabel>🎉 הקישור נוצר — הועתק ללוח!</CardLabel>

          {/* PRIMARY: the full shareable link */}
          <button
            onClick={() => navigator.clipboard.writeText(briefLink(newCode.token!))}
            title="לחץ להעתקה"
            className="w-full text-right flex items-center justify-between gap-3 bg-[#070A0E] border border-[#2A4158] rounded-lg px-4 py-3 mb-3 hover:border-[#D4AF55] transition-colors">
            <span className="font-mono text-sm text-[#D9E8F5] truncate" dir="ltr">{briefLink(newCode.token)}</span>
            <span className="text-[#6B8FA8] text-lg flex-shrink-0">📋</span>
          </button>

          <div className="flex flex-wrap gap-2 mb-3">
            <CopyBtn text={briefLink(newCode.token)} label="📋 העתק קישור" />
            <a
              href={whatsappShareLink(WA_MSG(briefLink(newCode.token)))}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#059669] hover:brightness-110 text-white text-sm font-semibold px-3 py-1.5 transition-all">
              💬 שלח ב-WhatsApp
            </a>
          </div>

          {/* FALLBACK: manual short code */}
          <Alert type="blue">
            או הזן קוד ידני: <strong className="font-mono tracking-widest">{newCode.code}</strong>
          </Alert>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardLabel>📋 איך זה עובד?</CardLabel>
          {[
            { n:'1', t:'לחץ "צור קישור חדש"', s:'יווצר קישור ייחודי' },
            { n:'2', t:'שלח ללקוח',           s:'דרך WhatsApp, אימייל...' },
            { n:'3', t:'הלקוח ממלא',          s:'שאלון 4 שלבים, ~5 דקות' },
            { n:'4', t:'AI בונה הכל',         s:'אווטאר + מודעות + משפך' },
          ].map(({ n, t, s }) => (
            <div key={n} className="flex items-start gap-3 py-2.5 border-b border-[#1E2F42] last:border-0">
              <div className="w-5 h-5 rounded-full bg-[#0A7AFF] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</div>
              <div>
                <div className="text-sm font-medium">{t}</div>
                <div className="text-xs text-[#6B8FA8]">{s}</div>
              </div>
            </div>
          ))}
        </Card>

        {codes.length > 0 && (
          <Card>
            <CardLabel>קישורים פעילים ({codes.length})</CardLabel>
            {codes.map(c => (
              <div key={c.code} className="flex items-center justify-between gap-2 py-2.5 border-b border-[#1E2F42] last:border-0">
                <span className="font-mono text-xs text-[#6B8FA8]">{c.code}</span>
                <div className="flex gap-2 flex-shrink-0">
                  {c.token && <CopyBtn text={briefLink(c.token)} label="🔗 קישור" />}
                  {c.token && (
                    <a
                      href={whatsappShareLink(WA_MSG(briefLink(c.token)))}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center rounded-lg bg-[#162030] border border-[#1E2F42] text-[#6B8FA8] hover:text-white hover:border-[#2A4158] text-xs font-medium px-2.5 py-1.5 transition-colors">
                      💬
                    </a>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
