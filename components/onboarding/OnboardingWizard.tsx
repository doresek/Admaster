'use client';
// components/onboarding/OnboardingWizard.tsx
// First-run 4-step wizard: role → connect client → first brief → done.
// Persists progress to users.onboarding via /api/onboarding. Reuses the
// existing /clients and /briefs flows rather than reimplementing them.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardLabel, Btn, Chip, Alert } from '@/components/ui';
import { MetaConnectGuide } from './MetaConnectGuide';

type Role = 'agency' | 'freelancer';

export function OnboardingWizard({ initialStep = 0, initialRole }: { initialStep?: number; initialRole?: Role }) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [role, setRole] = useState<Role | undefined>(initialRole);
  const [saving, setSaving] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    try {
      await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch { /* best-effort */ }
  };

  const next = async (extra: Record<string, unknown> = {}) => {
    const s = step + 1;
    setStep(s);
    await patch({ step: s, ...extra });
  };

  const finish = async () => {
    setSaving(true);
    await patch({ step: 4, completed_at: new Date().toISOString(), role });
    router.push('/cockpit');
  };

  const skip = async () => {
    await patch({ dismissed: true });
    router.push('/cockpit');
  };

  const STEPS = ['תפקיד', 'חיבור לקוח', 'בריף ראשון', 'סיום'];

  return (
    <div className="max-w-2xl mx-auto" dir="rtl">
      {/* progress */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border ${
              i <= step ? 'bg-[#0A7AFF] border-[#0A7AFF] text-white' : 'bg-[#111A24] border-[#1E2F42] text-[#5A6B7C]'
            }`}>{i < step ? '✓' : i + 1}</div>
            <span className={`text-xs ${i === step ? 'text-[#D9E8F5]' : 'text-[#5A6B7C]'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className={`h-[2px] flex-1 rounded ${i < step ? 'bg-[#0A7AFF]/40' : 'bg-[#1E2F42]'}`} />}
          </div>
        ))}
      </div>

      <Card>
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <CardLabel>ברוך הבא 👋 איך תשתמש ב-AdMaster?</CardLabel>
            <p className="text-sm text-[#8FA3B5]">נתאים לך את החוויה. תמיד אפשר לשנות.</p>
            <div className="flex gap-2">
              <Chip label="🏢 סוכנות שיווק" active={role === 'agency'} onClick={() => setRole('agency')} />
              <Chip label="👤 פרילנסר / עסק" active={role === 'freelancer'} onClick={() => setRole('freelancer')} />
            </div>
            <div className="flex justify-between mt-2">
              <Btn variant="ghost" size="sm" onClick={skip}>דלג</Btn>
              <Btn disabled={!role} onClick={() => next({ role })}>המשך</Btn>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <CardLabel>חבר את הלקוח הראשון שלך</CardLabel>
            <MetaConnectGuide />
            <div className="flex justify-between mt-2">
              <Btn variant="ghost" size="sm" onClick={() => next()}>אעשה זאת אחר כך</Btn>
              <div className="flex gap-2">
                <Btn variant="outline" onClick={() => window.open('/clients', '_blank')}>פתח מסך לקוחות</Btn>
                <Btn onClick={() => next()}>חיברתי — המשך</Btn>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <CardLabel>מלא בריף ראשון</CardLabel>
            <p className="text-sm text-[#8FA3B5]">
              הבריף הוא הדלק של ה-AI — כמה שאלות על העסק, וה-AI יודע לבנות מודעות, טרגוט וקמפיין.
            </p>
            <Alert type="blue">אפשר גם לשלוח ללקוח קישור בריף שימלא בעצמו, ממסך "בריפים".</Alert>
            <div className="flex justify-between mt-2">
              <Btn variant="ghost" size="sm" onClick={() => next()}>דלג</Btn>
              <div className="flex gap-2">
                <Btn variant="outline" onClick={() => window.open('/briefs', '_blank')}>פתח בריפים</Btn>
                <Btn onClick={() => next()}>המשך</Btn>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <CardLabel>הכל מוכן 🚀</CardLabel>
            <p className="text-sm text-[#8FA3B5]">
              עכשיו פשוט לחץ <b className="text-[#D9E8F5]">"עשה זאת בשבילי"</b> בקוקפיט — ה-AI ייצר מודעות,
              ינקד וישפר, יבדוק איכות, וישלח לך לאישור לפני השקה.
            </p>
            <div className="flex justify-end mt-2">
              <Btn onClick={finish} loading={saving}>קח אותי לקוקפיט</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
