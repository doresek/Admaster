'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const [form, setForm]     = useState({ name: '', email: '', pw: '', pw2: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const router = useRouter();
  const supabase = createClient();
  const u = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.pw !== form.pw2) { setError('הסיסמאות אינן תואמות'); return; }
    if (form.pw.length < 6)   { setError('סיסמה — לפחות 6 תווים');  return; }
    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.pw,
      options: { data: { name: form.name } },
    });

    if (error) { setError(error.message); setLoading(false); return; }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#070A0E] px-4" dir="rtl">
      <div className="bg-[#0C1118] border border-[#2A4158] rounded-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">Ad<em className="text-[#D4AF55] not-italic">Master</em> Pro</h1>
          <p className="text-[#6B8FA8] text-sm mt-1">🚀 הצטרף — 150 קרדיטים חינם</p>
        </div>

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
      </div>
    </div>
  );
}
