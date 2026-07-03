'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const [pw, setPw]           = useState('');
  const [pw2, setPw2]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  // 'checking' → verifying the recovery session; 'ready' → form; 'expired' → no session.
  const [status, setStatus]   = useState<'checking' | 'ready' | 'expired'>('checking');
  const supabase = createClient();

  // The recovery session should have been established by /auth/callback
  // (exchangeCodeForSession set the cookies). If it's missing/expired, show a
  // clear "request a new link" message instead of a form that will only fail.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setStatus(data.session ? 'ready' : 'expired');
    }).catch(() => { if (active) setStatus('expired'); });
    return () => { active = false; };
  }, [supabase]);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (pw !== pw2)   { setError('הסיסמאות אינן תואמות'); return; }
    if (pw.length < 6) { setError('סיסמה — לפחות 6 תווים');  return; }
    setLoading(true);

    // The recovery session was already established by /auth/callback.
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) { setError(error.message); setLoading(false); return; }
      window.location.href = '/login?reset=success';
    } catch {
      setError('שגיאת רשת — נסה שוב.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#070A0E] px-4" dir="rtl">
      <div className="bg-[#0C1118] border border-[#2A4158] rounded-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">
            Ad<em className="text-[#D4AF55] not-italic">Master</em> Pro
          </h1>
          <p className="text-[#6B8FA8] text-sm mt-1">בחירת סיסמה חדשה 🔐</p>
        </div>

        {status === 'checking' ? (
          <div className="text-center text-sm text-[#6B8FA8] py-6">בודק את הקישור…</div>
        ) : status === 'expired' ? (
          <div className="space-y-4">
            <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-3 text-center">
              הקישור פג תוקף או שכבר נעשה בו שימוש.
              <p className="text-xs text-[#6B8FA8] mt-2">בקש קישור איפוס חדש ונסה שוב.</p>
            </div>
            <p className="text-center text-xs text-[#6B8FA8]">
              <a href="/forgot-password" className="text-[#3D9FFF] font-semibold hover:underline">בקשת קישור חדש</a>
            </p>
          </div>
        ) : (
          <>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">סיסמה חדשה</label>
              <input
                type="password" value={pw} onChange={e => setPw(e.target.value)}
                className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF] text-left"
                dir="ltr" placeholder="לפחות 6 תווים" required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">אימות סיסמה</label>
              <input
                type="password" value={pw2} onChange={e => setPw2(e.target.value)}
                className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF] text-left"
                dir="ltr" placeholder="••••••••" required
              />
            </div>

            {error && <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>}

            <button
              type="submit" disabled={loading}
              className="w-full bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'מעדכן...' : 'עדכן סיסמה'}
            </button>
          </form>

          <p className="text-center text-xs text-[#6B8FA8] mt-4">
            <a href="/login" className="text-[#3D9FFF] font-semibold hover:underline">חזרה לכניסה</a>
          </p>
          </>
        )}
      </div>
    </div>
  );
}
