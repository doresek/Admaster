'use client';
import { BriefQuestionnaire } from '../BriefQuestionnaire';

// Thin client wrapper: renders the shared questionnaire and submits by token.
// The token path of /api/briefs/submit resolves token -> brief_code server-side.
export default function TokenBriefForm({
  token,
  agencyName,
}: {
  token: string;
  agencyName: string;
}) {
  return (
    <BriefQuestionnaire
      agencyName={agencyName}
      onSubmit={async (values) => {
        const res = await fetch('/api/briefs/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, values }),
        });
        const data = await res.json().catch(() => ({}));
        return res.ok ? { ok: true } : { ok: false, error: data.error };
      }}
    />
  );
}
