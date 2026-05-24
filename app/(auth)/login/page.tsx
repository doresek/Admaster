'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail]   = useState('');
  const [pw, setPw]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) { setError(error.message); setLoading(false); return; }
    router.push('/');
    router.refresh();
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
            <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">סיסמה</label>
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
