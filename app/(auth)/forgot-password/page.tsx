'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [sent, setSent]       = useState(false);
  const supabase = createClient();

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error) { setError(error.message); setLoading(false); return; }
      setSent(true); setLoading(false);
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
          <p className="text-[#6B8FA8] text-sm mt-1">איפוס סיסמה 🔑</p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="bg-green-900/20 border border-green-500/30 text-green-400 text-sm rounded-lg px-3 py-3 text-center">
              נשלח קישור לאיפוס ✉️
              <p className="text-xs text-[#6B8FA8] mt-2">בדוק את תיבת האימייל שלך והמשך מהקישור.</p>
            </div>
            <p className="text-center text-xs text-[#6B8FA8]">
              <a href="/login" className="text-[#3D9FFF] font-semibold hover:underline">חזרה לכניסה</a>
            </p>
          </div>
        ) : (
          <>
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">אימייל</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF] text-left"
                  dir="ltr" placeholder="you@example.com" required
                />
              </div>

              {error && <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>}

              <button
                type="submit" disabled={loading}
                className="w-full bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'שולח...' : 'שלח קישור לאיפוס'}
              </button>
            </form>

            <p className="text-center text-xs text-[#6B8FA8] mt-4">
              נזכרת בסיסמה?{' '}
              <a href="/login" className="text-[#3D9FFF] font-semibold hover:underline">כניסה</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
