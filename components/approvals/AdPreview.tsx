'use client';
// components/approvals/AdPreview.tsx
// Renders the ad AS IT WILL APPEAR — a platform-style Facebook-post frame —
// so the client approves something they can actually SEE.
// Used by BOTH the dashboard approvals list and the public /approve/[token]
// page. The frame is intentionally white on any background: it previews the
// real feed, not the app chrome.
import { useState } from 'react';
import { normalizeAdContent, groundingLine, firstLine } from './ad-content';

const TRUNCATE_AT = 220;

function Avatar({ name }: { name: string | null }) {
  const initial = (name ?? '').trim().charAt(0);
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0"
      style={{ background: 'linear-gradient(135deg, #0A7AFF, #3D9FFF)' }}
    >
      {initial || '✨'}
    </div>
  );
}

export function AdPreview({
  content,
  clientName,
  className,
}: {
  /** The raw `approvals.content` jsonb — any historical shape. */
  content: unknown;
  /** Overrides the snapshotted client_name when the caller knows better. */
  clientName?: string | null;
  className?: string;
}) {
  const ad = normalizeAdContent(content);
  const name = clientName ?? ad.clientName;
  const [expanded, setExpanded] = useState(false);

  const needsTruncate = ad.text.length > TRUNCATE_AT;
  const shownText = !needsTruncate || expanded
    ? ad.text
    : `${ad.text.slice(0, TRUNCATE_AT).replace(/\s+\S*$/, '')}…`;

  const why = groundingLine(ad);
  const hasMeta = !!(ad.audience || ad.budget || why || ad.judgeRationale);

  return (
    <div dir="rtl" className={`bg-white text-black rounded-xl overflow-hidden border border-black/10 shadow-sm ${className ?? ''}`}>
      {/* ── Post header: avatar + business name + sponsored label ── */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <Avatar name={name} />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-gray-900 truncate">{name || 'העסק שלך'}</div>
          <div className="text-[11px] text-gray-500">ממומן · 🌐</div>
        </div>
      </div>

      {/* ── Post body with "עוד…" truncation ── */}
      {ad.text && (
        <div className="px-4 pb-3 text-[14px] leading-relaxed text-gray-900 whitespace-pre-wrap">
          {shownText}
          {needsTruncate && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-gray-500 font-semibold hover:underline ms-1"
            >
              עוד…
            </button>
          )}
        </div>
      )}

      {ad.hashtags.length > 0 && (
        <div className="px-4 pb-3 text-[13px] text-[#0A66FF] leading-relaxed break-words">
          {ad.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
        </div>
      )}

      {/* ── Creative: real image if a URL exists, labeled prompt placeholder otherwise ── */}
      {ad.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.imageUrl} alt="" className="w-full max-h-96 object-cover border-y border-gray-200" />
      ) : ad.imagePrompt ? (
        <div className="bg-gradient-to-br from-slate-100 to-slate-200 border-y border-slate-200 px-5 py-7 text-center">
          <div className="text-3xl mb-2">🎨</div>
          <div className="text-[11px] font-bold text-slate-500 mb-1.5">קריאייטיב ויזואלי — ייווצר לפי התיאור:</div>
          <div className="text-[12px] text-slate-600 leading-relaxed max-w-md mx-auto">{ad.imagePrompt}</div>
        </div>
      ) : null}

      {/* ── CTA bar ── */}
      <div className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-2.5 border-t border-gray-200">
        <div className="text-[12px] text-gray-600 truncate">{name ? `${name} · פנו אלינו` : 'פנו אלינו'}</div>
        <div className="shrink-0 bg-gray-200 text-gray-800 rounded-md px-4 py-1.5 text-[13px] font-semibold">
          {ad.cta || 'לפרטים נוספים'}
        </div>
      </div>

      {/* ── Below the frame: audience / budget / grounded WHY (only what exists) ── */}
      {hasMeta && (
        <div className="border-t border-gray-200 bg-slate-50 px-4 py-3 space-y-1.5">
          {ad.audience && (
            <div className="text-[12px] text-slate-600">
              <span className="font-semibold">👥 קהל היעד:</span> {ad.audience}
            </div>
          )}
          {ad.budget && (
            <div className="text-[12px] text-slate-600">
              <span className="font-semibold">💰 תקציב:</span> {ad.budget}
            </div>
          )}
          {why && (
            <div className="text-[12px] text-slate-700 leading-relaxed">
              <span className="font-semibold">🧠</span> {why}
            </div>
          )}
          {!why && ad.judgeRationale && (
            <div className="text-[12px] text-slate-600 leading-relaxed">
              <span className="font-semibold">🧠 הערכת ה-AI:</span> {ad.judgeRationale}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact mini-preview for the dashboard list (dark UI): image thumb / placeholder + first post line. */
export function AdThumb({ content }: { content: unknown }) {
  const ad = normalizeAdContent(content);
  const line = firstLine(ad);
  return (
    <div dir="rtl" className="flex items-center gap-2.5 min-w-0">
      <div className="w-10 h-10 rounded-md overflow-hidden bg-[#070A0E] border border-[#2A4158] flex items-center justify-center shrink-0">
        {ad.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-base">{ad.imagePrompt ? '🎨' : '📝'}</span>
        )}
      </div>
      <div className="text-[11px] text-[#6B8FA8] truncate">{line || 'ללא טקסט'}</div>
    </div>
  );
}
