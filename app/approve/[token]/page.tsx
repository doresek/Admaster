'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface ApprovalData {
  id:              string;
  title:           string|null;
  content:         { text?: string; image_url?: string|null; [k: string]: any };
  status:          'pending'|'approved'|'changes'|'rejected';
  feedback:        string|null;
  created_at:      string;
  responded_at:    string|null;
  agency_name:     string;
  primary_color:   string;
  secondary_color: string;
}

export default function ApprovePage() {
  const { token } = useParams<{ token: string }>();
  const [data,     setData]     = useState<ApprovalData|null>(null);
  const [loading,  setLoading]  = useState(true);
  const [err,      setErr]      = useState('');
  const [feedback, setFeedback] = useState('');
  const [view,     setView]     = useState<'content' | 'feedback' | 'done'>('content');
  const [busy,     setBusy]     = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/approvals/public?token=${token}`);
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error);
      setData(d);
      if (d.status !== 'pending') setView('done');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (token) load(); }, [token]);

  async function respond(status: 'approved'|'changes'|'rejected') {
    if (status === 'changes' && view !== 'feedback') {
      setView('feedback');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/approvals/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, status, feedback: feedback || null }),
      });
      const d = await res.json();
      if (!res.ok || !d?.success) throw new Error(d.error || 'שגיאה');
      await load();
      setView('done');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center" dir="rtl">
      <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
    </div>
  );

  if (err || !data) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center" dir="rtl">
      <div className="text-center">
        <div className="text-5xl mb-3">😕</div>
        <div className="text-slate-700 font-semibold">{err || 'הקישור לא נמצא'}</div>
      </div>
    </div>
  );

  const primary = data.primary_color || '#0A7AFF';
  const secondary = data.secondary_color || '#D4AF55';

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Branded header */}
        <div className="rounded-2xl overflow-hidden shadow-lg bg-white">
          <div className="p-5 text-white" style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}>
            <div className="text-xs opacity-90 mb-1">{data.agency_name}</div>
            <div className="text-xl font-bold">{data.title || 'בקשת אישור'}</div>
            <div className="text-xs opacity-80 mt-1">
              נשלח אליך לאישור · {new Date(data.created_at).toLocaleDateString('he')}
            </div>
          </div>

          <div className="p-6">
            {data.content?.image_url && (
              <img src={data.content.image_url} alt="" className="w-full rounded-lg mb-4 border" />
            )}
            <div className="whitespace-pre-wrap text-base leading-relaxed text-slate-800 mb-6">
              {data.content?.text}
            </div>

            {view === 'done' && (
              <div className="text-center py-6">
                <div className="text-5xl mb-3">
                  {data.status === 'approved' ? '🎉' : data.status === 'changes' ? '✍️' : data.status === 'rejected' ? '❌' : '⏳'}
                </div>
                <div className="text-lg font-bold text-slate-800 mb-1">
                  {data.status === 'approved' && 'אישרת את התוכן!'}
                  {data.status === 'changes' && 'ביקשת שינויים'}
                  {data.status === 'rejected' && 'דחית את התוכן'}
                  {data.status === 'pending' && 'ממתין לתגובתך'}
                </div>
                {data.feedback && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 text-right">
                    💬 הפידבק שלך: {data.feedback}
                  </div>
                )}
                <div className="text-xs text-slate-500 mt-4">
                  התגובה נשלחה ל{data.agency_name}
                </div>
              </div>
            )}

            {view === 'content' && (
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={() => respond('approved')} disabled={busy}
                  className="flex-1 py-3 rounded-lg font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
                  style={{ background: '#059669' }}>
                  ✅ אשר
                </button>
                <button onClick={() => respond('changes')} disabled={busy}
                  className="flex-1 py-3 rounded-lg font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
                  style={{ background: '#D97706' }}>
                  ✍️ בקש שינויים
                </button>
                <button onClick={() => respond('rejected')} disabled={busy}
                  className="flex-1 py-3 rounded-lg font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
                  style={{ background: '#DC2626' }}>
                  ❌ דחה
                </button>
              </div>
            )}

            {view === 'feedback' && (
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-slate-700">מה צריך לשנות?</label>
                <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={4}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
                  placeholder="לדוגמה: 'לשנות את הכותרת לגרסה יותר אישית' או 'להוסיף הנחה של 20%'" />
                <div className="flex gap-2">
                  <button onClick={() => respond('changes')} disabled={busy || !feedback.trim()}
                    className="flex-1 py-2.5 rounded-lg font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
                    style={{ background: primary }}>
                    📤 שלח פידבק
                  </button>
                  <button onClick={() => setView('content')} disabled={busy}
                    className="py-2.5 px-4 rounded-lg font-bold text-slate-700 bg-slate-100 hover:bg-slate-200">
                    חזור
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="text-center text-xs text-slate-400 mt-6">
          הקישור מאובטח ופרטי · התשובה נשלחת ל-{data.agency_name}
        </div>
      </div>
    </div>
  );
}
