'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { friendlyAuthError } from '@/lib/auth-messages';

export default function LoginPage() {
  const [email, setEmail]   = useState('');
  const [pw, setPw]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');
  const supabase = createClient();

  // Surface status passed via the URL by the callback / reset / confirm flows.
  // Read from window (not useSearchParams) to avoid a Suspense boundary requirement.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) setError(friendlyAuthError(err));
    if (params.get('reset') === 'success') setNotice('הסיסמה עודכנה. אפשר להתחבר עם הסיסמה החדשה.');
    if (params.get('confirmed') === '1') setNotice('האימייל אומת. אפשר להתחבר.');
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(''); setNotice('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) { setError(error.message); setLoading(false); return; }
      window.location.href = '/';
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
          <p className="text-[#6B8FA8] text-sm mt-1">ברוך השב 👋</p>
        </div>

        {notice && <div className="bg-green-900/20 border border-green-500/30 text-green-400 text-xs rounded-lg px-3 py-2 mb-4 text-center">{notice}</div>}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">אימייל</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF] text-left"
              dir="ltr" placeholder="you@example.com" required
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-[#6B8FA8]">סיסמה</label>
              <a href="/forgot-password" className="text-xs text-[#3D9FFF] hover:underline">שכחת סיסמה?</a>
            </div>
            <input
              type="password" value={pw} onChange={e => setPw(e.target.value)}
              className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF] text-left"
              dir="ltr" placeholder="••••••••" required
            />
          </div>

          {error && <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>}

          <button
            type="submit" disabled={loading}
            className="w-full bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'מתחבר...' : 'כניסה →'}
          </button>
        </form>

        <p className="text-center text-xs text-[#6B8FA8] mt-4">
          אין חשבון?{' '}
          <a href="/register" className="text-[#3D9FFF] font-semibold hover:underline">הרשם חינם</a>
        </p>
      </div>
    </div>
  );
}
