'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { collectClientSignals } from '@/lib/anti-abuse/fingerprint';

export default function RegisterPage() {
  const [form, setForm]     = useState({ name: '', email: '', pw: '', pw2: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [confirmSent, setConfirmSent] = useState(false);
  // Anti-abuse phone-verification step (shown only when signup returns a live
  // session, i.e. email-confirmation OFF). With confirmation ON the OTP step
  // runs after the user confirms + logs in — see TODO below.
  const [phoneStep, setPhoneStep] = useState(false);
  const [phone, setPhone]         = useState('');
  const [code, setCode]           = useState('');
  const [otpSent, setOtpSent]     = useState(false);
  const [devCode, setDevCode]     = useState<string | null>(null);
  const supabase = createClient();
  const u = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.pw !== form.pw2) { setError('הסיסמאות אינן תואמות'); return; }
    if (form.pw.length < 6)   { setError('סיסמה — לפחות 6 תווים');  return; }
    setLoading(true);

    let data, error;
    try {
      ({ data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.pw,
        options: {
          data: { name: form.name },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/`,
        },
      }));
    } catch {
      setError('שגיאת רשת — נסה שוב.'); setLoading(false); return;
    }

    if (error) { setError(error.message); setLoading(false); return; }

    // Email-confirmation ON: a user is returned but no session yet.
    // TODO(anti-abuse): when confirmation is ON, gate the OTP step behind the
    // post-confirmation login (the /api/signup/* routes require a session).
    if (data?.user && !data.session) { setConfirmSent(true); setLoading(false); return; }

    // Confirmation OFF: session is live. Require phone verification ONLY when it's
    // switched on (NEXT_PUBLIC_SIGNUP_PHONE_VERIFICATION=true) — which the operator
    // does after InforU SMS creds are set. Until then the OTP path can't deliver a
    // code in prod (mock SMS), so gating it would break signup. Dormant-safe default.
    setLoading(false);
    if (process.env.NEXT_PUBLIC_SIGNUP_PHONE_VERIFICATION === 'true') {
      setPhoneStep(true);
    } else {
      window.location.href = '/';
    }
  }

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/signup/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, deviceFingerprint: collectClientSignals() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'שליחת הקוד נכשלה'); setLoading(false); return; }
      setOtpSent(true);
      setDevCode(json.devCode ?? null); // dev/mock only
    } catch {
      setError('שגיאת רשת');
    }
    setLoading(false);
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/signup/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'אימות נכשל'); setLoading(false); return; }
      window.location.href = '/';
    } catch {
      setError('שגיאת רשת');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#070A0E] px-4" dir="rtl">
      <div className="bg-[#0C1118] border border-[#2A4158] rounded-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">Ad<em className="text-[#D4AF55] not-italic">Master</em> Pro</h1>
          <p className="text-[#6B8FA8] text-sm mt-1">🚀 הצטרף — 150 קרדיטים חינם</p>
        </div>

        {confirmSent ? (
          <div className="space-y-4">
            <div className="bg-green-900/20 border border-green-500/30 text-green-400 text-sm rounded-lg px-3 py-3 text-center">
              בדוק את האימייל לאישור ✉️
              <p className="text-xs text-[#6B8FA8] mt-2">שלחנו קישור אישור ל־{form.email}. לחץ עליו כדי להפעיל את החשבון.</p>
            </div>
            <p className="text-center text-xs text-[#6B8FA8]">
              <a href="/login" className="text-[#3D9FFF] font-semibold hover:underline">חזרה לכניסה</a>
            </p>
          </div>
        ) : phoneStep ? (
          <div className="space-y-4">
            <div className="bg-blue-900/20 border border-blue-500/30 text-blue-300 text-xs rounded-lg px-3 py-2 text-center">
              📱 אימות טלפון — שלב אחרון להפעלת החשבון
            </div>
            {!otpSent ? (
              <form onSubmit={sendOtp} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">מספר טלפון</label>
                  <input
                    type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                    className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF]"
                    dir="ltr" placeholder="050-1234567" required
                  />
                </div>
                {error && <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>}
                <button type="submit" disabled={loading}
                  className="w-full bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50">
                  {loading ? 'שולח קוד...' : 'שלח קוד אימות'}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-3">
                {devCode && (
                  <div className="bg-yellow-900/20 border border-yellow-500/30 text-yellow-300 text-xs rounded-lg px-3 py-2 text-center">
                    מצב פיתוח — הקוד שלך: <b>{devCode}</b>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">קוד אימות (6 ספרות)</label>
                  <input
                    type="text" inputMode="numeric" value={code} onChange={e => setCode(e.target.value)}
                    className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF] tracking-widest text-center"
                    dir="ltr" placeholder="______" maxLength={6} required
                  />
                </div>
                {error && <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>}
                <button type="submit" disabled={loading}
                  className="w-full bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50">
                  {loading ? 'מאמת...' : 'אמת והמשך'}
                </button>
                <button type="button" onClick={() => { setOtpSent(false); setError(''); }}
                  className="w-full text-xs text-[#6B8FA8] hover:underline">שלח קוד מחדש</button>
              </form>
            )}
          </div>
        ) : (
        <>
        <form onSubmit={handleRegister} className="space-y-3">
          {[
            { k: 'name',  l: 'שם מלא',        ph: 'שם שלך',            type: 'text',     dir: 'rtl' },
            { k: 'email', l: 'אימייל',          ph: 'you@example.com',  type: 'email',    dir: 'ltr' },
            { k: 'pw',    l: 'סיסמה',          ph: 'לפחות 6 תווים',    type: 'password', dir: 'ltr' },
            { k: 'pw2',   l: 'אימות סיסמה',    ph: '••••••••',          type: 'password', dir: 'ltr' },
          ].map(({ k, l, ph, type, dir }) => (
            <div key={k}>
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">{l}</label>
              <input
                type={type} value={form[k as keyof typeof form]}
                onChange={e => u(k, e.target.value)}
                className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF]"
                dir={dir as 'ltr' | 'rtl'} placeholder={ph} required
              />
            </div>
          ))}

          {error && <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>}

          <div className="bg-blue-900/20 border border-blue-500/30 text-blue-300 text-xs rounded-lg px-3 py-2">
            🎁 150 קרדיטים מתנה בהרשמה
          </div>

          <button
            type="submit" disabled={loading}
            className="w-full bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'יוצר חשבון...' : 'צור חשבון חינם'}
          </button>
        </form>

        <p className="text-center text-xs text-[#6B8FA8] mt-4">
          יש חשבון?{' '}
          <a href="/login" className="text-[#3D9FFF] font-semibold hover:underline">כניסה</a>
        </p>
        </>
        )}
      </div>
    </div>
  );
}
