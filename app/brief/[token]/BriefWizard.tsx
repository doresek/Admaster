// app/brief/[token]/BriefWizard.tsx
'use client';

import {
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type ChangeEvent,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FormData = Record<string, string>;

interface Props {
  token: string;
  briefId: string;
  initialData: Record<string, unknown>;
  initialStep: number;
  agencyName: string;
  clientName: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 5;

const STEP_META: { number: string; title: string; subtitle: string }[] = [
  {
    number: '01',
    title: 'נכיר את העסק',
    subtitle: 'מי אתה ומה הסיפור שמאחורי המותג',
  },
  {
    number: '02',
    title: 'איפה רואים אתכם',
    subtitle: 'הקישורים לרשתות החברתיות והאתר',
  },
  {
    number: '03',
    title: 'ההצעה ללקוח',
    subtitle: 'מה הוא מקבל, במה זה שונה, ולמה ממך',
  },
  {
    number: '04',
    title: 'הלקוח האידיאלי',
    subtitle: 'הפסיכולוגיה של מי שאתה רוצה להגיע אליו',
  },
  {
    number: '05',
    title: 'עוד משהו לסיום',
    subtitle: 'כל מה שלא נשאלת אבל חשוב שנדע',
  },
];

const REQUIRED_FIELDS = [
  'biz_name',
  'biz_description',
  'biz_product',
  'ad_language',
  'voice_choice',
  'price',
  'whats_included',
  'usp',
  'pain_main',
  'pain_emotion',
  'dream_outcome',
  'common_objection',
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function BriefWizard({
  token,
  initialData,
  initialStep,
  agencyName,
  clientName,
}: Props) {
  const [step, setStep] = useState<number>(
    Math.min(Math.max(1, initialStep), TOTAL_STEPS)
  );

  // Coerce initial data to all-strings; the form treats everything as text
  const [data, setData] = useState<FormData>(() => {
    const out: FormData = {};
    for (const [k, v] of Object.entries(initialData || {})) {
      out[k] = v == null ? '' : String(v);
    }
    return out;
  });

  const [saving, setSaving] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipFirstSave = useRef<boolean>(true); // don't autosave on initial mount

  // ---------- progress (based on required fields only) ----------
  const filled = REQUIRED_FIELDS.filter(
    (f) => data[f] && String(data[f]).trim().length > 0
  ).length;
  const progressPct = Math.round((filled / REQUIRED_FIELDS.length) * 100);

  // ---------- autosave with debounce ----------
  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSaving(true);
        setSaveError(null);
        const res = await fetch(`/api/brief/${token}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: data,
            current_step: step,
            progress_pct: progressPct,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        setLastSaved(new Date());
      } catch (e: unknown) {
        setSaveError(e instanceof Error ? e.message : 'save failed');
      } finally {
        setSaving(false);
      }
    }, 800);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, step]);

  // ---------- handlers ----------
  const update = (key: string, value: string) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const goNext = () => {
    if (step < TOTAL_STEPS) {
      setStep((s) => s + 1);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  const goPrev = () => {
    if (step > 1) {
      setStep((s) => s - 1);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/brief/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: data }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setSubmitted(true);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- thank-you screen ----------
  if (submitted) {
    return <ThankYou agencyName={agencyName} />;
  }

  const meta = STEP_META[step - 1];
  const isLast = step === TOTAL_STEPS;
  const formValid = REQUIRED_FIELDS.every(
    (f) => data[f] && String(data[f]).trim().length > 0
  );

  // ---------- render ----------
  return (
    <div
      className="min-h-screen bg-stone-50 selection:bg-amber-200 selection:text-stone-900"
      dir="rtl"
    >
      {/* ──────────── top header ──────────── */}
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500 font-medium">
              {agencyName}
            </div>
            <h1 className="text-lg font-serif text-stone-900 mt-0.5">
              טופס בריפינג
            </h1>
          </div>
          <AutosaveBadge
            saving={saving}
            lastSaved={lastSaved}
            error={saveError}
          />
        </div>
      </header>

      {/* ──────────── greeting (only on step 1, only if we have client_name) ──────────── */}
      {step === 1 && clientName && (
        <div className="max-w-3xl mx-auto px-6 pt-8 pb-2">
          <p className="text-stone-600 text-lg leading-relaxed">
            שלום <span className="text-stone-900 font-medium">{clientName}</span>,
            אנחנו אוספים פרטים שיעזרו לנו ליצור עבורך מודעות שעובדות. ייקח כ-10
            דקות. כל הפרטים נשמרים אוטומטית — אפשר לחזור מאוחר יותר.
          </p>
        </div>
      )}

      {/* ──────────── step indicator row ──────────── */}
      <div className="max-w-3xl mx-auto px-6 pt-8">
        <div className="flex items-end justify-between mb-6">
          <div className="flex items-baseline gap-1.5 text-sm">
            <span className="text-stone-400">שלב</span>
            <span className="font-serif text-stone-900 text-base">{step}</span>
            <span className="text-stone-400">מתוך {TOTAL_STEPS}</span>
          </div>
          <div className="text-xs text-stone-500 tracking-wider">
            הושלמו {progressPct}% משדות החובה
          </div>
        </div>

        {/* steps as numerals with a thin progress line under each */}
        <div className="grid grid-cols-5 gap-2 mb-10">
          {STEP_META.map((m, i) => {
            const n = i + 1;
            const isActive = n === step;
            const isDone = n < step;
            return (
              <div key={m.number} className="flex flex-col items-start">
                <span
                  className={`font-serif text-2xl leading-none transition-colors ${
                    isActive
                      ? 'text-stone-900'
                      : isDone
                        ? 'text-amber-700'
                        : 'text-stone-300'
                  }`}
                >
                  {m.number}
                </span>
                <span
                  className={`mt-2 h-px w-full transition-colors ${
                    isActive
                      ? 'bg-stone-900'
                      : isDone
                        ? 'bg-amber-700'
                        : 'bg-stone-200'
                  }`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ──────────── content card ──────────── */}
      <main className="max-w-3xl mx-auto px-6 pb-24">
        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="px-7 md:px-10 pt-9 pb-2">
            <h2 className="font-serif text-3xl md:text-4xl text-stone-900 leading-tight">
              {meta.title}
            </h2>
            <p className="text-stone-500 mt-2 text-base leading-relaxed">
              {meta.subtitle}
            </p>
          </div>

          <div className="h-px bg-stone-100 mx-7 md:mx-10 my-7" />

          <div className="px-7 md:px-10 pb-10 space-y-7">
            {step === 1 && <Step1 data={data} update={update} />}
            {step === 2 && <Step2 data={data} update={update} />}
            {step === 3 && <Step3 data={data} update={update} />}
            {step === 4 && <Step4 data={data} update={update} />}
            {step === 5 && <Step5 data={data} update={update} />}
          </div>
        </div>

        {/* error banner */}
        {saveError && !submitting && (
          <div className="mt-4 px-5 py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">
            שגיאה בשמירה: {saveError}. נסה שוב או רענן את העמוד.
          </div>
        )}

        {/* ──────────── nav ──────────── */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={step === 1}
            className="px-5 py-2.5 text-stone-700 font-medium rounded-xl hover:bg-white hover:border-stone-200 border border-transparent transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← הקודם
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !formValid}
              className="group px-7 py-3 rounded-xl bg-stone-900 text-white font-medium hover:bg-stone-800 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
            >
              {submitting ? (
                <>
                  <Spinner /> שולח...
                </>
              ) : (
                <>
                  שמירת הבריף
                  <span className="text-amber-400">✓</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              className="px-6 py-2.5 rounded-xl bg-stone-900 text-white font-medium hover:bg-stone-800 transition shadow-sm"
            >
              הבא →
            </button>
          )}
        </div>

        {!formValid && isLast && (
          <p className="mt-3 text-xs text-stone-500 text-left">
            יש למלא את כל שדות החובה לפני ההגשה.
          </p>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Autosave badge
// ---------------------------------------------------------------------------

function AutosaveBadge({
  saving,
  lastSaved,
  error,
}: {
  saving: boolean;
  lastSaved: Date | null;
  error: string | null;
}) {
  if (error) {
    return (
      <span className="text-xs text-rose-700 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
        שגיאה בשמירה
      </span>
    );
  }
  if (saving) {
    return (
      <span className="text-xs text-stone-500 flex items-center gap-2">
        <Spinner /> שומר...
      </span>
    );
  }
  if (lastSaved) {
    return (
      <span className="text-xs text-emerald-700 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        נשמר אוטומטית
      </span>
    );
  }
  return (
    <span className="text-xs text-stone-400 flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-stone-300" />
      מוכן
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin w-3.5 h-3.5"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-20"
      />
      <path
        d="M22 12a10 10 0 00-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Thank-you screen (post-submit)
// ---------------------------------------------------------------------------

function ThankYou({ agencyName }: { agencyName: string }) {
  return (
    <div
      className="min-h-screen bg-stone-50 flex items-center justify-center p-6"
      dir="rtl"
    >
      <div className="bg-white rounded-3xl border border-stone-200 max-w-md w-full p-10 text-center shadow-sm">
        <div className="font-serif text-5xl text-amber-700 mb-4">✓</div>
        <h1 className="font-serif text-3xl text-stone-900 mb-3">תודה!</h1>
        <p className="text-stone-600 leading-relaxed mb-1">
          הבריף נשמר בהצלחה.
        </p>
        <p className="text-stone-600 leading-relaxed">
          <span className="text-stone-900 font-medium">{agencyName}</span> יחזור
          אליך בקרוב עם המודעות.
        </p>
        <div className="mt-8 pt-6 border-t border-stone-100 text-xs text-stone-400">
          אפשר לסגור את החלון הזה.
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// FIELD PRIMITIVE
// ===========================================================================

const inputClass =
  'w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 placeholder:text-stone-400 focus:bg-white focus:border-stone-900 focus:ring-2 focus:ring-stone-900/5 outline-none transition';

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block mb-2">
        <span className="text-stone-900 font-medium text-[15px]">{label}</span>
        {required && <span className="text-amber-700 mr-1.5">*</span>}
      </label>
      {hint && (
        <p className="text-stone-500 text-sm mb-2.5 leading-relaxed">{hint}</p>
      )}
      {children}
    </div>
  );
}

interface StepProps {
  data: FormData;
  update: (key: string, value: string) => void;
}

// ===========================================================================
// STEP 1 — business intro
// ===========================================================================

function Step1({ data, update }: StepProps) {
  const handle =
    (key: string) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      update(key, e.target.value);

  return (
    <>
      <Field label="מה שם העסק שלך?" required>
        <input
          type="text"
          value={data.biz_name || ''}
          onChange={handle('biz_name')}
          placeholder="לדוגמה: תכשיטי שרה"
          className={inputClass}
        />
      </Field>

      <Field label="במה העסק עוסק?" required hint="במשפט-שניים, כאילו אתה מספר לחבר">
        <textarea
          value={data.biz_description || ''}
          onChange={handle('biz_description')}
          placeholder="מה אתם בעצם עושים"
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field
        label="מה המוצר או השירות שנקדם עכשיו?"
        required
        hint="לא הכל — רק זה שאנחנו מפרסמים בקמפיין הזה"
      >
        <textarea
          value={data.biz_product || ''}
          onChange={handle('biz_product')}
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field label="באיזו שפה תהיינה המודעות?" required>
        <select
          value={data.ad_language || ''}
          onChange={handle('ad_language')}
          className={inputClass}
        >
          <option value="">בחרו שפה...</option>
          <option value="he">עברית</option>
          <option value="en">אנגלית</option>
          <option value="ru">רוסית</option>
          <option value="ar">ערבית</option>
        </select>
      </Field>

      <Field
        label="סיפור ההקמה"
        hint="למה הקמת את העסק? עברת בעצמך את הקושי שאתה פותר היום לאחרים?"
      >
        <textarea
          value={data.founder_story || ''}
          onChange={handle('founder_story')}
          placeholder="הסיפור האנושי שמאחורי המותג"
          rows={4}
          className={inputClass}
        />
      </Field>

      <Field
        label="מי מדבר במודעות?"
        required
        hint="האם המודעות ידברו בשמך האישי, או בשם המותג?"
      >
        <select
          value={data.voice_choice || ''}
          onChange={handle('voice_choice')}
          className={inputClass}
        >
          <option value="">בחרו...</option>
          <option value="personal">בשמי האישי (אני הפרזנטור)</option>
          <option value="brand">בשם המותג</option>
          <option value="both">משולב</option>
        </select>
      </Field>

      {(data.voice_choice === 'personal' || data.voice_choice === 'both') && (
        <Field
          label="ספר על עצמך"
          hint="מי אתה, מה הרקע, ולמה אתה הכתובת הנכונה בתחום הזה?"
        >
          <textarea
            value={data.founder_intro || ''}
            onChange={handle('founder_intro')}
            rows={4}
            className={inputClass}
          />
        </Field>
      )}

      <Field
        label="השליחות שלך"
        hint="מה הדבר שהכי מרגש אותך בעסק, או בתוצאות של הלקוחות שלך?"
      >
        <textarea
          value={data.mission || ''}
          onChange={handle('mission')}
          rows={3}
          className={inputClass}
        />
      </Field>
    </>
  );
}

// ===========================================================================
// STEP 2 — channels
// ===========================================================================

function Step2({ data, update }: StepProps) {
  const linkField = (key: string, label: string, placeholder: string) => (
    <Field label={label}>
      <input
        type="url"
        value={data[key] || ''}
        onChange={(e) => update(key, e.target.value)}
        placeholder={placeholder}
        className={inputClass}
        dir="ltr"
      />
    </Field>
  );

  return (
    <>
      {linkField('website_url', 'כתובת האתר או דף הנחיתה', 'https://...')}
      {linkField('instagram_url', 'אינסטגרם', 'https://instagram.com/...')}
      {linkField('facebook_url', 'פייסבוק', 'https://facebook.com/...')}
      {linkField('tiktok_url', 'טיקטוק', 'https://tiktok.com/@...')}
      {linkField('linkedin_url', 'לינקדאין', 'https://linkedin.com/...')}
      {linkField('youtube_url', 'יוטיוב', 'https://youtube.com/...')}

      <Field label="לינקים נוספים" hint="אם יש מקומות נוספים שנרצה לראות">
        <textarea
          value={data.other_links || ''}
          onChange={(e) => update('other_links', e.target.value)}
          rows={2}
          className={inputClass}
          dir="ltr"
        />
      </Field>
    </>
  );
}

// ===========================================================================
// STEP 3 — offer
// ===========================================================================

function Step3({ data, update }: StepProps) {
  const handle =
    (key: string) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      update(key, e.target.value);

  return (
    <>
      <Field label="כמה זה עולה?" required>
        <input
          type="text"
          value={data.price || ''}
          onChange={handle('price')}
          placeholder='לדוגמה: 1,990 ש"ח, או טווח 500-2,000'
          className={inputClass}
        />
      </Field>

      <Field label="מה הלקוח מקבל בתכלס?" required hint="פירוט של מה כלול בחבילה">
        <textarea
          value={data.whats_included || ''}
          onChange={handle('whats_included')}
          rows={4}
          className={inputClass}
        />
      </Field>

      <Field
        label="צ׳ופר או בונוס?"
        hint="לדוגמה: ייעוץ חינם, חודש ראשון במתנה, מוצר נלווה"
      >
        <textarea
          value={data.bonus || ''}
          onChange={handle('bonus')}
          rows={2}
          className={inputClass}
        />
      </Field>

      <Field
        label="יש אחריות?"
        hint='לדוגמה: "לא אהבת — לא שילמת", החזר כספי תוך 14 יום'
      >
        <textarea
          value={data.guarantee || ''}
          onChange={handle('guarantee')}
          rows={2}
          className={inputClass}
        />
      </Field>

      <Field
        label="למה כדאי לקנות דווקא ממך?"
        required
        hint='מה ה"קסם" המיוחד שלך, שמתחרים לא נותנים?'
      >
        <textarea
          value={data.usp || ''}
          onChange={handle('usp')}
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field
        label="מרכיב הקסם"
        hint="הדבר האחד שאתם עושים אחרת מכל השוק. למה זה עובד איפה שאחרים נכשלו?"
      >
        <textarea
          value={data.secret_sauce || ''}
          onChange={handle('secret_sauce')}
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field
        label="התהליך"
        hint="תאר בקצרה את הדרך של הלקוח, מהרכישה ועד התוצאה"
      >
        <textarea
          value={data.process || ''}
          onChange={handle('process')}
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field
        label="סיפור הצלחה"
        hint="לקוח אחד ששינית לו את החיים או העסק. מה היה לפני ומה אחרי?"
      >
        <textarea
          value={data.success_story || ''}
          onChange={handle('success_story')}
          rows={4}
          className={inputClass}
        />
      </Field>
    </>
  );
}

// ===========================================================================
// STEP 4 — psychology
// ===========================================================================

function Step4({ data, update }: StepProps) {
  const handle =
    (key: string) => (e: ChangeEvent<HTMLTextAreaElement>) =>
      update(key, e.target.value);

  return (
    <>
      <Field
        label="מה הבעיה הכי גדולה של הלקוח, לפני שהוא הגיע אליך?"
        required
        hint="מה מפריע לו לישון בלילה?"
      >
        <textarea
          value={data.pain_main || ''}
          onChange={handle('pain_main')}
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field
        label="איך הוא מרגיש לגבי המצב הזה?"
        required
        hint="לדוגמה: מתוסכל, עייף, חושש, מבולבל, מובס"
      >
        <textarea
          value={data.pain_emotion || ''}
          onChange={handle('pain_emotion')}
          rows={2}
          className={inputClass}
        />
      </Field>

      <Field
        label="איך יראו החיים שלו אחרי שישתמש במוצר שלך?"
        required
        hint="התמונה האידיאלית של אחרי"
      >
        <textarea
          value={data.dream_outcome || ''}
          onChange={handle('dream_outcome')}
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field
        label="מה התירוץ הכי נפוץ של אנשים שלא קונים?"
        required
        hint='לדוגמה: "יקר לי", "אולי בהמשך", "אני לא בטוח שזה בשבילי"'
      >
        <textarea
          value={data.common_objection || ''}
          onChange={handle('common_objection')}
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field
        label="המחשבה המפחידה"
        hint="מה יקרה ללקוח אם לא יפתור את הבעיה בחודשים הקרובים?"
      >
        <textarea
          value={data.scary_thought || ''}
          onChange={handle('scary_thought')}
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field
        label="מיתוסים וטעויות"
        hint='מה הלקוח חושב בטעות על הפתרון? למשל: "זה דורש הרבה זמן", "זה רק לעשירים"'
      >
        <textarea
          value={data.myths || ''}
          onChange={handle('myths')}
          rows={3}
          className={inputClass}
        />
      </Field>

      <Field
        label="הסטטוס החדש"
        hint="איך הסביבה (משפחה / חברים / קולגות) תסתכל עליו, אחרי שישיג את התוצאה?"
      >
        <textarea
          value={data.new_status || ''}
          onChange={handle('new_status')}
          rows={3}
          className={inputClass}
        />
      </Field>
    </>
  );
}

// ===========================================================================
// STEP 5 — extra
// ===========================================================================

function Step5({ data, update }: StepProps) {
  return (
    <Field
      label="כל מה שלא נשאלת"
      hint="סיפור, ביטוי שלקוחות אומרים, דוגמה, אזהרה — כל דבר שיעזור לנו"
    >
      <textarea
        value={data.extra_info || ''}
        onChange={(e) => update('extra_info', e.target.value)}
        rows={10}
        placeholder="כתבו כל דבר שעולה לכם לראש..."
        className={inputClass}
      />
    </Field>
  );
}
