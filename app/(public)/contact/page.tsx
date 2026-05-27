'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function ContactPage() {
  const [form,    setForm]    = useState({ name: '', email: '', subject: '', message: '' });
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) return;
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בשליחת ההודעה');
      setSent(true);
      setForm({ name: '', email: '', subject: '', message: '' });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-4 py-16 max-w-2xl mx-auto">
      <div className="text-center mb-10">
        <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-2">צור קשר</div>
        <h1 className="text-4xl font-bold text-white mb-3" style={{ fontFamily: 'DM Serif Display,serif' }}>
          מעוניין לדבר?
        </h1>
        <p className="text-[#6B8FA8]">מענה תוך 24 שעות בימי עסקים</p>
      </div>

      <div className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-6">
        {sent ? (
          <div className="text-center py-10">
            <div className="text-5xl mb-3">✅</div>
            <div className="text-xl font-bold text-white mb-2">ההודעה נשלחה!</div>
            <div className="text-[#6B8FA8] mb-6">נחזור אליך בהקדם.</div>
            <Link href="/welcome" className="inline-block px-5 py-2.5 bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-bold rounded-lg">
              חזור לדף הבית
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">שם מלא *</label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required
                  className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white focus:border-[#0A7AFF] focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">אימייל *</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} required dir="ltr"
                  className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white focus:border-[#0A7AFF] focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">נושא</label>
              <input value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))}
                className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white focus:border-[#0A7AFF] focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">הודעה *</label>
              <textarea value={form.message} onChange={e => setForm(f => ({...f, message: e.target.value}))} required rows={6}
                className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white focus:border-[#0A7AFF] focus:outline-none resize-y" />
            </div>

            {err && (
              <div className="bg-red-900/10 border border-red-500/20 text-red-400 px-3 py-2 rounded-lg text-sm">
                ❌ {err}
              </div>
            )}

            <button type="submit" disabled={loading || !form.name || !form.email || !form.message}
              className="w-full py-3 bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50">
              {loading ? 'שולח...' : '📤 שלח הודעה'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
