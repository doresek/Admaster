'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Btn, Alert, PageHeader, CopyBtn } from '@/components/ui';

export default function SendBriefPage() {
  const [codes,   setCodes]   = useState<string[]>([]);
  const [newCode, setNewCode] = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('brief_codes').select('code').eq('user_id', user.id)
        .then(({ data }) => setCodes(data?.map(r => r.code) ?? []));
    });
  }, []);

  async function create() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('users').select('name').eq('id', user.id).single();
    await supabase.from('brief_codes').insert({ code, user_id: user.id, agency_name: profile?.name });
    setCodes(p => [...p, code]);
    setNewCode(code);
    navigator.clipboard.writeText(code);
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://admaster-pro.co.il';
  const briefUrl = `${origin}/brief?code=`;

  return (
    <div>
      <PageHeader eyebrow="שיתוף" title="שלח בריף ללקוח"
        sub="הלקוח ממלא → אתה מקבל אווטאר + מודעות + משפך"
        right={<Btn variant="primary" onClick={create}>+ צור קישור חדש</Btn>} />

      {newCode && (
        <Card className="mb-4" style={{ borderColor: 'rgba(184,149,58,.3)' }}>
          <CardLabel>🎉 קישור נוצר — הועתק ללוח!</CardLabel>
          <div className="flex items-center justify-between bg-[#0B1424] border border-[#324C6B] rounded-lg px-5 py-4 mb-3">
            <span className="font-mono text-3xl text-[#D4AF55] tracking-widest">{newCode}</span>
            <CopyBtn text={newCode} label="📋 העתק קוד" />
          </div>
          <div className="flex gap-2">
            <CopyBtn text={`${briefUrl}${newCode}`} label="🔗 העתק קישור מלא" />
          </div>
          <Alert type="blue" className="mt-3">
            💡 שלח ללקוח: כנס ל-<strong className="font-mono">{briefUrl}{newCode}</strong>
          </Alert>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardLabel>📋 איך זה עובד?</CardLabel>
          {[
            { n:'1', t:'לחץ "צור קישור חדש"', s:'יווצר קוד ייחודי' },
            { n:'2', t:'שלח ללקוח',           s:'דרך WhatsApp, אימייל...' },
            { n:'3', t:'הלקוח ממלא',          s:'שאלון 4 שלבים, ~5 דקות' },
            { n:'4', t:'AI בונה הכל',         s:'אווטאר + מודעות + משפך' },
          ].map(({ n, t, s }) => (
            <div key={n} className="flex items-start gap-3 py-2.5 border-b border-[#243752] last:border-0">
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
            <CardLabel>קודים פעילים ({codes.length})</CardLabel>
            {codes.map(c => (
              <div key={c} className="flex items-center justify-between py-2.5 border-b border-[#243752] last:border-0">
                <span className="font-mono text-sm text-[#D4AF55]">{c}</span>
                <div className="flex gap-2">
                  <CopyBtn text={c} label="קוד" />
                  <CopyBtn text={`${briefUrl}${c}`} label="קישור" />
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
