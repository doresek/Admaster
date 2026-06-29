'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { BriefQuestionnaire } from './BriefQuestionnaire';

// Legacy ?code= entry point (manual code entry). The newer magic-link flow lives
// at app/brief/[token]/page.tsx. Both render the same BriefQuestionnaire.

export default function BriefFormPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070A0E]" />}>
      <BriefFormPage />
    </Suspense>
  );
}

function BriefFormPage() {
  const params = useSearchParams();
  const code   = params.get('code') ?? '';
  const [agencyName, setAgencyName] = useState('');

  useEffect(() => {
    if (!code) return;
    fetch(`/api/briefs/code-meta?code=${code}`)
      .then(r => r.json())
      .then(d => { if (d.agency_name) setAgencyName(d.agency_name); })
      .catch(() => {});
  }, [code]);

  if (!code) return (
    <div className="min-h-screen bg-[#070A0E] flex items-center justify-center p-4" dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}>
      <div className="bg-[#0C1118] border border-[#2A4158] rounded-2xl p-8 w-full max-w-sm text-center">
        <div className="text-4xl mb-4">🔗</div>
        <div className="text-white font-bold text-xl mb-2">הזן קוד בריף</div>
        <div className="text-[#6B8FA8] text-sm mb-6">הזן את הקוד שקיבלת מהסוכן שלך</div>
        <CodeEntry />
      </div>
    </div>
  );

  return (
    <BriefQuestionnaire
      agencyName={agencyName}
      onSubmit={async (values) => {
        const res = await fetch('/api/briefs/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, values }),
        });
        const data = await res.json().catch(() => ({}));
        return res.ok ? { ok: true } : { ok: false, error: data.error };
      }}
    />
  );
}

// Code entry component
function CodeEntry() {
  const [code, setCode] = useState('');
  return (
    <div>
      <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
        placeholder="לדוגמה: AB3X7K"
        className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-center font-mono text-lg text-white outline-none focus:border-[#0A7AFF] mb-3"
        dir="ltr" maxLength={8} />
      <button
        onClick={() => { if (code.trim()) window.location.href = `/brief?code=${code.trim()}`; }}
        disabled={!code.trim()}
        className="w-full py-2.5 rounded-lg bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white font-semibold text-sm transition-colors disabled:opacity-50">
        פתח בריף →
      </button>
    </div>
  );
}
