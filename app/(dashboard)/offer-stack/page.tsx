'use client';
import { useState } from 'react';
import { Card, CardLabel, Btn, Alert, PageHeader, CostBadge, CopyBtn, Textarea, Input } from '@/components/ui';

interface OfferStack {
  product_name: string;
  main_offer:   { name: string; price: number; value: number };
  bonuses:      { name: string; value: number; why_it_matters: string }[];
  total_value:  number;
  price_anchor: number;
  final_price:  number;
  guarantee:    string;
  scarcity:     string;
  urgency:      string;
  cta:          string;
  full_pitch:   string;
}

export default function OfferStackPage() {
  const [product,  setProduct]  = useState('');
  const [audience, setAudience] = useState('');
  const [outcome,  setOutcome]  = useState('');
  const [price,    setPrice]    = useState('');
  const [out,      setOut]      = useState<OfferStack|null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function build() {
    if (!product.trim()) return;
    setLoading(true); setError(''); setOut(null);
    try {
      const res = await fetch('/api/tools', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tool: 'offer_stack', input: { product, audience, outcome, current_price: price } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      setOut(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  const savings = out ? out.price_anchor - out.final_price : 0;
  const pct     = out && out.price_anchor ? Math.round((savings / out.price_anchor) * 100) : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Value Stack"
        title="💎 בניית הצעה (Offer Stack)"
        sub="הצעה שלא ניתן לסרב לה — Alex Hormozi style"
        right={<CostBadge cost={6} />}
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>פרטי המוצר / השירות</CardLabel>
            <Textarea label="מה המוצר / השירות?" value={product} onChange={setProduct} placeholder="לדוגמה: קורס דיגיטל ליועצי משכנתאות, 90 ימי ליווי" rows={3} />
            <Input label="קהל יעד" value={audience} onChange={setAudience} placeholder="יועצים עם 2+ שנות ניסיון" />
            <Input label="התוצאה שהלקוח יקבל" value={outcome} onChange={setOutcome} placeholder="הכפלת ההכנסה החודשית תוך 90 ימים" />
            <Input label="מחיר נוכחי / רצוי (אופציונלי)" value={price} onChange={setPrice} placeholder="1,997 ₪" />
          </Card>
          <Btn variant="gold" full loading={loading} onClick={build} disabled={!product.trim()}>
            💎 בנה הצעה מנצחת
          </Btn>
          {error && <Alert type="red">❌ {error}</Alert>}
        </div>

        <div>
          {out ? (
            <>
              {/* Pricing comparison */}
              <Card className="mb-3 text-center" style={{ borderColor: 'rgba(184,149,58,.3)' }}>
                <div className="text-xs text-[#6B8FA8] mb-1">ערך אמיתי</div>
                <div className="font-mono text-lg text-[#6B8FA8] line-through">₪{out.price_anchor.toLocaleString()}</div>
                <div className="font-mono text-4xl font-bold text-[#D4AF55] my-2">₪{out.final_price.toLocaleString()}</div>
                {pct > 0 && (
                  <div className="inline-block bg-[#059669]/15 border border-[#059669]/30 text-[#34D399] text-xs font-bold px-3 py-1 rounded-full">
                    חיסכון {pct}% · ₪{savings.toLocaleString()}
                  </div>
                )}
              </Card>

              {/* Value stack */}
              <Card className="mb-3" style={{ borderColor: 'rgba(184,149,58,.4)' }}>
                <CardLabel>⭐ Value Stack</CardLabel>
                <div className="space-y-2">
                  <div className="flex justify-between items-start py-2 border-b border-[#243752]">
                    <div className="flex-1">
                      <div className="font-bold text-sm text-[#D9E8F5]">🎯 {out.main_offer.name}</div>
                      <div className="text-[11px] text-[#6B8FA8]">ההצעה הראשית</div>
                    </div>
                    <div className="font-mono text-sm text-[#D4AF55]">₪{out.main_offer.value.toLocaleString()}</div>
                  </div>
                  {out.bonuses.map((b, i) => (
                    <div key={i} className="flex justify-between items-start py-2 border-b border-[#243752] last:border-0">
                      <div className="flex-1">
                        <div className="font-semibold text-sm text-[#D9E8F5]">🎁 {b.name}</div>
                        <div className="text-[11px] text-[#6B8FA8] mt-0.5">{b.why_it_matters}</div>
                      </div>
                      <div className="font-mono text-sm text-[#D4AF55]">₪{b.value.toLocaleString()}</div>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-3 border-t-2 border-[#D4AF55]/40">
                    <span className="font-bold text-base text-[#D9E8F5]">ערך כולל</span>
                    <span className="font-mono text-lg font-bold text-[#D4AF55]">₪{out.total_value.toLocaleString()}</span>
                  </div>
                </div>
              </Card>

              {/* Trust + urgency */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {out.guarantee && (
                  <Card>
                    <CardLabel>🛡 גרנטי</CardLabel>
                    <div className="text-[12px] text-[#D9E8F5] leading-relaxed">{out.guarantee}</div>
                  </Card>
                )}
                {out.scarcity && (
                  <Card>
                    <CardLabel>📊 מחסור</CardLabel>
                    <div className="text-[12px] text-[#D9E8F5] leading-relaxed">{out.scarcity}</div>
                  </Card>
                )}
                {out.urgency && (
                  <Card>
                    <CardLabel>⏰ דחיפות</CardLabel>
                    <div className="text-[12px] text-[#D9E8F5] leading-relaxed">{out.urgency}</div>
                  </Card>
                )}
              </div>

              {out.cta && (
                <Card className="mb-3" style={{ borderColor: 'rgba(220,38,38,.3)' }}>
                  <CardLabel>📣 CTA</CardLabel>
                  <div className="font-bold text-lg text-red-400">{out.cta}</div>
                </Card>
              )}

              {out.full_pitch && (
                <Card style={{ borderColor: 'rgba(10,122,255,.3)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <CardLabel>🎤 Pitch מוכן</CardLabel>
                    <CopyBtn text={out.full_pitch} label="📋 העתק" />
                  </div>
                  <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-[#D9E8F5]">{out.full_pitch}</div>
                </Card>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-80 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
              <span className="text-5xl mb-3 opacity-30">💎</span>
              <span className="text-sm">מלא פרטים ולחץ "בנה הצעה"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
