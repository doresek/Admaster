// components/onboarding/MetaConnectGuide.tsx
// Friendly, step-by-step explanation of connecting a Meta account. The actual
// token exchange reuses the existing /clients flow (POST /api/meta/clients) —
// we link there rather than reimplement it, so this stays in sync.
import { Alert } from '@/components/ui';

export function MetaConnectGuide() {
  const steps = [
    'היכנס ל-Meta Business / Facebook Developers וצור או בחר אפליקציה.',
    'פתח את Graph API Explorer, בחר את העמוד וחשבון המודעות שלך.',
    'אשר את ההרשאות (pages_show_list, ads_management) וצור User Access Token.',
    'העתק את הטוקן — נדביק אותו במסך "לקוחות".',
  ];
  return (
    <div className="flex flex-col gap-3" dir="rtl">
      <ol className="list-decimal pr-5 space-y-1.5 text-sm text-[#8FA3B5]">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <Alert type="blue">
        טיפ: זה חד-פעמי לכל לקוח. אחרי החיבור, כל היצירה, ההשקה והניתוח עובדים אוטומטית.
      </Alert>
    </div>
  );
}
