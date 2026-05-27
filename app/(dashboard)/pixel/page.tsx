'use client';
// ════════════════════════════════════════════════════════════
// PIXEL BUILDER PAGE
// ════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Input, Btn, Alert, PageHeader, CopyBtn } from '@/components/ui';
import type { MetaClient } from '@/types';

export default function PixelPage() {
  const [clients, setClients] = useState<MetaClient[]>([]);
  const [pixels,  setPixels]  = useState<any[]>([]);
  const [selC,    setSelC]    = useState('');
  const [form,    setForm]    = useState({ name:'', websiteUrl:'' });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('meta_clients').select('*').eq('user_id', user.id)
        .then(({ data }) => { setClients(data??[]); if(data?.[0]) { setSelC(data[0].id); loadPixels(data[0].id); } });
    });
  }, []);

  async function loadPixels(clientId: string) {
    const res = await fetch(`/api/pixel?clientId=${clientId}`);
    const data = await res.json();
    setPixels(Array.isArray(data) ? data : []);
  }

  async function createPixel() {
    if (!form.name || !selC) return;
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/pixel', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ clientId:selC, name:form.name, websiteUrl:form.websiteUrl }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPixels(p=>[data,...p]);
      setForm({ name:'', websiteUrl:'' });
    } catch(e:any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <PageHeader eyebrow="Meta" title="Pixel Builder" sub="צור ונהל Facebook Pixels ללקוחות" />

      {clients.length === 0 && <Alert type="amber">⚠️ חבר לקוח Meta תחילה</Alert>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>צור Pixel חדש</CardLabel>
            <div className="flex flex-wrap gap-2 mb-3">
              {clients.map(c=><button key={c.id} onClick={()=>{setSelC(c.id);loadPixels(c.id);}}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${selC===c.id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#243752] bg-[#1A2A42] text-[#6B8FA8]'}`}>
                <span>{c.emoji}</span>{c.name}
              </button>)}
            </div>
            <Input label="שם ה-Pixel" value={form.name} onChange={v=>setForm(p=>({...p,name:v}))} placeholder="Pixel - אלירן תפילין" />
            <Input label="כתובת האתר" value={form.websiteUrl} onChange={v=>setForm(p=>({...p,websiteUrl:v}))} placeholder="https://your-site.co.il" />
            {error && <Alert type="red">{error}</Alert>}
            <Btn variant="primary" loading={loading} onClick={createPixel} disabled={!form.name||!selC}>➕ צור Pixel</Btn>
          </Card>

          <Card>
            <CardLabel>📋 אירועים נפוצים</CardLabel>
            {[
              ['PageView','צפייה בדף','טען אוטומטית'],
              ['Lead','ליד','שליחת טופס'],
              ['Purchase','רכישה','עסקה הושלמה'],
              ['AddToCart','הוסף לעגלה',''],
              ['InitiateCheckout','התחל צ\'קאאוט',''],
              ['ViewContent','צפייה בתוכן','דף מוצר'],
            ].map(([e,l,s])=>(
              <div key={e} className="flex items-center justify-between py-2 border-b border-[#243752] last:border-0">
                <div><div className="text-xs font-mono text-[#3D9FFF]">{e}</div><div className="text-[10px] text-[#6B8FA8]">{l}{s?` — ${s}`:''}</div></div>
                <code className="text-[10px] text-[#2E4459]">fbq('track','{e}')</code>
              </div>
            ))}
          </Card>
        </div>

        <div>
          {pixels.map(px=>(
            <Card key={px.id} className="mb-3">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-bold text-sm">{px.name}</div>
                  {px.meta_pixel_id && <div className="text-xs font-mono text-[#D4AF55]">ID: {px.meta_pixel_id}</div>}
                </div>
                <div className="text-[10px] font-bold px-2 py-1 rounded-full bg-[#059669]/10 border border-[#059669]/20 text-[#34D399]">פעיל</div>
              </div>
              {px.pixel_code && (
                <>
                  <div className="bg-[#0B1424] rounded-lg p-3 mb-2 font-mono text-[11px] text-[#6B8FA8] max-h-32 overflow-y-auto whitespace-pre-wrap" dir="ltr">
                    {px.pixel_code.substring(0,300)}...
                  </div>
                  <div className="flex gap-2">
                    <CopyBtn text={px.pixel_code} label="📋 העתק קוד" />
                    <Btn variant="ghost" size="sm" onClick={()=>window.open(`https://business.facebook.com/events_manager/pixel/${px.meta_pixel_id}`,'_blank')}>
                      פתח ב-Meta →
                    </Btn>
                  </div>
                  <Alert type="blue" className="mt-2 text-xs">💡 הדבק את הקוד בין תגי &lt;head&gt; של האתר, לפני &lt;/head&gt;</Alert>
                </>
              )}
            </Card>
          ))}
          {pixels.length===0&&<div className="flex flex-col items-center justify-center h-48 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]"><span className="text-4xl mb-3 opacity-30">📊</span><span className="text-sm">צור Pixel ראשון</span></div>}
        </div>
      </div>
    </div>
  );
}
