'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Input, Textarea, Chip, Btn, Alert, PageHeader } from '@/components/ui';
import type { BrandDNA } from '@/types';

const TONES = ['חם ואישי', 'מקצועי', 'חסידי', 'דחיפות', 'חינוכי', 'סיפור'];

export default function BrandPage() {
  const [brand, setBrand] = useState<BrandDNA>({});
  const [saving, setSaving]   = useState(false);
  const [saved,  setSaved]    = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const ub = (k: keyof BrandDNA, v: string) => setBrand(p => ({ ...p, [k]: v }));

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('users').select('brand').eq('id', user.id).single()
        .then(({ data }) => { if (data?.brand) setBrand(data.brand); setLoading(false); });
    });
  }, []);

  async function save() {
    setSaving(true); setSaved(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from('users').update({ brand, updated_at: new Date().toISOString() }).eq('id', user.id);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader eyebrow="Brand" title="Brand DNA" sub="כל פוסט ומודעה שיווצרו יתואמו אוטומטית לפרטים אלו" />

      {saved && <Alert type="green">✅ Brand DNA נשמר בהצלחה!</Alert>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-4">
            <CardLabel>🏢 פרטי העסק</CardLabel>
            <Input label="שם העסק" value={brand.name ?? ''} onChange={v => ub('name', v)} placeholder="אלירן קהלני תפילין ומזוזות" />
            <Input label="סלוגן" value={brand.tagline ?? ''} onChange={v => ub('tagline', v)} placeholder="מהדרין בכל מצווה" />
            <Input label="מיקום" value={brand.location ?? ''} onChange={v => ub('location', v)} placeholder="ראשון לציון" />
            <Input label="טלפון / WhatsApp" value={brand.phone ?? ''} onChange={v => ub('phone', v)} placeholder="050-000-0000" />
            <Input label="אתר" value={brand.website ?? ''} onChange={v => ub('website', v)} placeholder="www.example.co.il" />
          </Card>

          <Card>
            <CardLabel>🎯 טון דיבור</CardLabel>
            <div className="flex flex-wrap gap-2">
              {TONES.map(t => <Chip key={t} label={t} active={brand.tone === t} onClick={() => ub('tone', t)} />)}
            </div>
          </Card>
        </div>

        <div>
          <Card className="mb-4">
            <CardLabel>🎯 קהל יעד ויתרון</CardLabel>
            <Textarea label="קהל יעד" value={brand.audience ?? ''} onChange={v => ub('audience', v)}
              placeholder="משפחות דתיות, אבות לבני מצווה, קהילות חב״ד, בעלי תשובה..." rows={3} />
            <Textarea label="מה מייחד אותך?" value={brand.usp ?? ''} onChange={v => ub('usp', v)}
              placeholder="ניסיון 15 שנה, הכשרה בחב״ד, בדיקת מחשב, אחריות לכל החיים..." rows={3} />
            <Textarea label="כאבי לקוח" value={brand.pains ?? ''} onChange={v => ub('pains', v)}
              placeholder="לא יודע אם תפיליו כשרות, מחפש מישהו אמין, חושש מקנייה לא מוצלחת..." rows={3} />
            <Textarea label="מוצרים ושירותים" value={brand.products ?? ''} onChange={v => ub('products', v)}
              placeholder="תפילין מהודרות, מזוזות, בדיקת מזוזות, חבילות בר מצווה..." rows={2} />
          </Card>

          <Btn variant="primary" full loading={saving} onClick={save}>
            💾 שמור Brand DNA
          </Btn>
        </div>
      </div>
    </div>
  );
}
