'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Input, Textarea, Btn, Alert, PageHeader } from '@/components/ui';

export default function AgencyPage() {
  const [settings, setSettings] = useState({ agency_name:'', primary_color:'#0A7AFF', secondary_color:'#D4AF55', custom_domain:'', support_email:'', whatsapp_number:'', footer_text:'' });
  const [plan,     setPlan]     = useState('free');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('agency_settings').select('*').eq('user_id', user.id).single()
        .then(({ data }) => { if (data) setSettings(s=>({...s,...data})); });
      supabase.from('users').select('plan').eq('id', user.id).single()
        .then(({ data }) => setPlan(data?.plan||'free'));
    });
  }, []);

  const u = (k: string, v: string) => setSettings(p=>({...p,[k]:v}));

  async function save() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('agency_settings').upsert({ ...settings, user_id: user.id, updated_at: new Date().toISOString() });
    setSaving(false); setSaved(true); setTimeout(()=>setSaved(false), 3000);
  }

  const isAgency = ['pro','agency'].includes(plan);

  return (
    <div>
      <PageHeader eyebrow="White Label" title="הגדרות סוכנות" sub="התאם אישית את המותג של הפלטפורמה" />

      {!isAgency && (
        <Alert type="amber">⚠️ White-Label זמין בתוכנית Pro ומעלה — <a href="/credits" className="font-bold underline">שדרג</a></Alert>
      )}

      {saved && <Alert type="green">✅ הגדרות נשמרו!</Alert>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>🏢 מיתוג הסוכנות</CardLabel>
            <Input label="שם הסוכנות" value={settings.agency_name} onChange={v=>u('agency_name',v)} placeholder="SocialPro Agency" />
            <Input label="אימייל תמיכה" value={settings.support_email} onChange={v=>u('support_email',v)} placeholder="support@your-agency.co.il" />
            <Input label="WhatsApp תמיכה" value={settings.whatsapp_number} onChange={v=>u('whatsapp_number',v)} placeholder="050-000-0000" />
            <div className="mb-3">
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">טקסט footer</label>
              <textarea value={settings.footer_text} onChange={e=>u('footer_text',e.target.value)} rows={2}
                className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-[#D9E8F5] outline-none focus:border-[#0A7AFF] resize-y"
                placeholder="כל הזכויות שמורות © SocialPro" dir="rtl" />
            </div>
          </Card>

          <Card className="mb-3">
            <CardLabel>🎨 צבעים</CardLabel>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">צבע ראשי</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={settings.primary_color} onChange={e=>u('primary_color',e.target.value)} className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent" />
                  <input type="text" value={settings.primary_color} onChange={e=>u('primary_color',e.target.value)}
                    className="flex-1 bg-[#162030] border border-[#1E2F42] rounded-lg px-2 py-2 text-sm text-[#D9E8F5] outline-none font-mono" dir="ltr" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">צבע שני</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={settings.secondary_color} onChange={e=>u('secondary_color',e.target.value)} className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent" />
                  <input type="text" value={settings.secondary_color} onChange={e=>u('secondary_color',e.target.value)}
                    className="flex-1 bg-[#162030] border border-[#1E2F42] rounded-lg px-2 py-2 text-sm text-[#D9E8F5] outline-none font-mono" dir="ltr" />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardLabel>🌐 דומיין מותאם (Agency בלבד)</CardLabel>
            <Input label="Sub-domain" value={settings.custom_domain} onChange={v=>u('custom_domain',v)} placeholder="your-agency.admaster-pro.co.il" />
            <Alert type="blue">💡 לאחר שמירה, צור CNAME record: <code className="font-mono text-xs">cname.vercel-dns.com</code></Alert>
          </Card>
        </div>

        {/* Preview */}
        <div>
          <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">תצוגה מקדימה</div>
          <div className="bg-[#0C1118] rounded-xl overflow-hidden border border-[#2A4158]">
            {/* Mock sidebar preview */}
            <div className="bg-[#070A0E] p-4 border-b border-[#1E2F42]">
              <div className="text-lg font-bold" style={{ color: settings.secondary_color }}>
                {settings.agency_name || 'שם הסוכנות'}
              </div>
              <div className="text-[10px] text-[#2E4459] mt-0.5">AI Social Media Platform</div>
            </div>
            <div className="p-4">
              {[1,2,3].map(i=>(
                <div key={i} className="flex items-center gap-2 py-2 rounded-lg px-2 mb-1" style={{ background: i===1?`${settings.primary_color}15`:'' }}>
                  <div className="w-3 h-3 rounded-full opacity-50" style={{ background: settings.primary_color }} />
                  <div className="h-2 rounded-full bg-[#1E2F42] flex-1" style={{ background: i===1?`${settings.primary_color}40`:'' }} />
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-[#1E2F42]">
              <div className="h-1.5 rounded-full overflow-hidden bg-[#1D2D3E]">
                <div className="h-full rounded-full w-2/3" style={{ background: settings.primary_color }} />
              </div>
              {settings.footer_text && <div className="text-[10px] text-[#2E4459] mt-2">{settings.footer_text}</div>}
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">תוכניות White-Label</div>
            {[
              { plan:'Pro', price:'₪199', features:['לוגו מותאם','צבעים מותאמים','5 לקוחות Meta','5 חברי צוות'] },
              { plan:'Agency', price:'₪499', features:['דומיין מותאם','לוגו + צבעים','לקוחות ללא הגבלה','20 חברי צוות','דוחות White-Label'] },
            ].map(p=>(
              <div key={p.plan} className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold" style={{ color: settings.primary_color }}>{p.plan}</div>
                  <div className="font-mono font-bold">{p.price}/חודש</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.features.map(f=><span key={f} className="text-[10px] bg-[#1D2D3E] text-[#6B8FA8] px-2 py-0.5 rounded">✓ {f}</span>)}
                </div>
              </div>
            ))}
          </div>

          <Btn variant="primary" full loading={saving} onClick={save} disabled={!isAgency}>
            💾 שמור הגדרות
          </Btn>
        </div>
      </div>
    </div>
  );
}
