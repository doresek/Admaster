// Public terminal page for the session-less client-connect flow. The callback
// redirects here with ?meta=connected|cancelled|error after the OAuth
// round-trip. No auth — purely a status display.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Shell({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div
      className="min-h-screen bg-[#070A0E] flex items-center justify-center p-4"
      dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}
    >
      <div className="bg-[#0C1118] border border-[#2A4158] rounded-2xl p-8 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">{icon}</div>
        <div className="text-white font-bold text-xl mb-2">{title}</div>
        <div className="text-[#6B8FA8] text-sm leading-relaxed">{sub}</div>
      </div>
    </div>
  );
}

export default function ConnectDonePage({
  searchParams,
}: {
  searchParams: { meta?: string };
}) {
  const status = searchParams.meta;

  if (status === 'connected') {
    return (
      <Shell
        icon="✅"
        title="החיבור הושלם!"
        sub="חשבון הפייסבוק חובר בהצלחה. אפשר לסגור את החלון הזה."
      />
    );
  }
  if (status === 'cancelled') {
    return (
      <Shell
        icon="🚫"
        title="החיבור בוטל"
        sub="לא אושרה הגישה לפייסבוק. אפשר לפתוח שוב את הקישור כדי לנסות שוב."
      />
    );
  }
  return (
    <Shell
      icon="⚠️"
      title="משהו השתבש"
      sub="לא הצלחנו להשלים את החיבור. בקש מהסוכן שלך לשלוח קישור חדש."
    />
  );
}
