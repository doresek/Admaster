'use client';
// app/(dashboard)/contacts/page.tsx — the client's CONSENTED contact list (CP-6b T5).
//
// Consent-first UX: the add form and the CSV import literally cannot submit
// without the explicit consent attestation (checkbox + consent_source). The
// API (app/api/retention/contacts) enforces the same rules structurally —
// this page never offers a bypass. "Delete" is an OPT-OUT tombstone, never a
// hard delete (re-import can never resurrect).

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardLabel, Chip, Input, Select, Btn, Alert, PageHeader } from '@/components/ui';
import { useActiveClient } from '@/components/ClientProvider';
import { parseTagsInput } from '@/app/api/retention/enroll/eligibility';

interface Contact {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  tags: string[];
  consent_source: string;
  consented_at: string;
  opted_out_at: string | null;
  last_purchase_at: string | null;
  created_at: string;
}

interface ImportSummary {
  total: number;
  inserted: number;
  skipped_duplicate: number;
  skipped_opted_out: number;
  rejected: number;
}
interface ImportRowResult { index: number; action: string; error?: string }

const CONSENT_SOURCE_OPTIONS = [
  { value: 'manual',       label: 'הסכמה ידנית (שיחה / פרונטלי)' },
  { value: 'landing_page', label: 'דף נחיתה' },
  { value: 'checkout',     label: 'רכישה / צ׳ק-אאוט' },
  { value: 'import',       label: 'ייבוא רשימה קיימת (עם הסכמה)' },
  { value: 'api',          label: 'API' },
];

const CONSENT_LABELS: Record<string, string> = Object.fromEntries(
  CONSENT_SOURCE_OPTIONS.map(o => [o.value, o.label]),
);

export default function ContactsPage() {
  const { activeClient, activeClientId } = useActiveClient();

  const [contacts,    setContacts]    = useState<Contact[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [showOptedOut, setShowOptedOut] = useState(false);
  const [err,         setErr]         = useState('');
  const [notice,      setNotice]      = useState('');

  // add-single form
  const [fullName,   setFullName]   = useState('');
  const [phone,      setPhone]      = useState('');
  const [email,      setEmail]      = useState('');
  const [tagsRaw,    setTagsRaw]    = useState('');
  const [source,     setSource]     = useState('manual');
  const [evidence,   setEvidence]   = useState('');
  const [attested,   setAttested]   = useState(false);
  const [saving,     setSaving]     = useState(false);

  // CSV import
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvSource,   setCsvSource]   = useState('import');
  const [csvEvidence, setCsvEvidence] = useState('');
  const [csvAttested, setCsvAttested] = useState(false);
  const [importing,   setImporting]   = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importErrors,  setImportErrors]  = useState<ImportRowResult[]>([]);

  const load = useCallback(async () => {
    if (!activeClientId) { setContacts([]); return; }
    setLoading(true); setErr('');
    try {
      const qs = new URLSearchParams({ client_id: activeClientId });
      if (showOptedOut) qs.set('include_opted_out', 'true');
      const res = await fetch(`/api/retention/contacts?${qs}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'שגיאה בטעינת אנשי קשר');
      setContacts(d.contacts ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setLoading(false);
    }
  }, [activeClientId, showOptedOut]);

  useEffect(() => { load(); }, [load]);

  const canSubmit = attested && (phone.trim() || email.trim()) && !!activeClientId;

  async function addContact() {
    if (!canSubmit || saving) return;            // consent attestation is a hard gate
    setSaving(true); setErr(''); setNotice('');
    try {
      const res = await fetch('/api/retention/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: activeClientId,
          contact: {
            full_name: fullName || undefined,
            phone: phone || undefined,
            email: email || undefined,
            tags: parseTagsInput(tagsRaw),
            consent_source: source,
            consented_at: new Date().toISOString(),   // the attestation moment
            consent_evidence: evidence || `אישור בעלים בטופס (${CONSENT_LABELS[source] ?? source})`,
          },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'שגיאה בשמירה');
      setNotice('✓ איש הקשר נוסף לרשימה');
      setFullName(''); setPhone(''); setEmail(''); setTagsRaw(''); setEvidence(''); setAttested(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setSaving(false);
    }
  }

  async function importCsv() {
    const file = fileRef.current?.files?.[0];
    if (!file || !csvAttested || !activeClientId || importing) return;
    setImporting(true); setErr(''); setNotice(''); setImportSummary(null); setImportErrors([]);
    try {
      const form = new FormData();
      form.set('client_id', activeClientId);
      form.set('file', file);
      // Bulk consent attestation — merged UNDER each row server-side; rows
      // carrying their own consent columns keep them.
      form.set('consent_source', csvSource);
      form.set('consented_at', new Date().toISOString());
      form.set('consent_evidence', csvEvidence || `ייבוא CSV "${file.name}" עם אישור הסכמה של הבעלים`);
      const res = await fetch('/api/retention/contacts', { method: 'POST', body: form });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'שגיאה בייבוא');
      setImportSummary(d.summary as ImportSummary);
      setImportErrors(((d.results ?? []) as ImportRowResult[]).filter(r => r.action === 'rejected').slice(0, 10));
      if (fileRef.current) fileRef.current.value = '';
      setCsvAttested(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setImporting(false);
    }
  }

  async function optOut(c: Contact) {
    const who = c.full_name || c.phone || c.email || 'איש הקשר';
    // Tombstone, not delete — irreversible by design (re-import never resurrects).
    if (!window.confirm(`להסיר את ${who} מרשימת התפוצה?\nזוהי הסרה קבועה (tombstone) — ייבוא חוזר לא יחזיר אותו לרשימה.`)) return;
    setErr('');
    try {
      const res = await fetch('/api/retention/contacts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: c.id, reason: 'הסרה ידנית מדף אנשי הקשר' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'שגיאה בהסרה');
      setNotice(`✓ ${who} הוסר מהרשימה (ההסרה נשמרת לצמיתות)`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שגיאה');
    }
  }

  const active = contacts.filter(c => !c.opted_out_at);

  return (
    <div>
      <PageHeader
        eyebrow="Retention"
        title="אנשי קשר"
        sub="רשימת התפוצה של הלקוח — אנשי קשר עם הסכמה מפורשת בלבד"
      />

      {!activeClientId && (
        <Alert type="amber" className="mb-4">בחר לקוח פעיל מהמתג למעלה כדי לנהל את רשימת אנשי הקשר שלו</Alert>
      )}

      {err && <Alert type="red" className="mb-3">❌ {err}</Alert>}
      {notice && <Alert type="green" className="mb-3">{notice}</Alert>}

      <div className="grid grid-cols-2 gap-4">
        {/* ── right column: add + import ── */}
        <div>
          <Card className="mb-3">
            <CardLabel>הוספת איש קשר</CardLabel>
            <div className="space-y-2">
              <Input label="שם מלא" value={fullName} onChange={setFullName} placeholder="ישראל ישראלי" />
              <Input label="טלפון" value={phone} onChange={setPhone} placeholder="+9725… / 05…" />
              <Input label="אימייל" value={email} onChange={setEmail} placeholder="name@example.com" type="email" />
              <Input label="תגיות (מופרדות בפסיק)" value={tagsRaw} onChange={setTagsRaw} placeholder="vip, רכש-2026, ניוזלטר" />
              <Select label="מקור ההסכמה" value={source} onChange={setSource} options={CONSENT_SOURCE_OPTIONS} />
              <Input label="אסמכתא (אופציונלי)" value={evidence} onChange={setEvidence} placeholder="למשל: טופס הרשמה מ-12.6, שיחת טלפון" />
            </div>

            {/* THE consent gate — without it the button stays disabled */}
            <label className="flex items-start gap-2 mt-3 p-3 rounded-lg border border-[#1E2F42] bg-[#162030] cursor-pointer">
              <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} className="mt-0.5" />
              <span className="text-[12px] text-[#D9E8F5] leading-relaxed">
                אני מאשר/ת שאיש קשר זה נתן <b>הסכמה מפורשת</b> לקבלת הודעות שיווקיות מהעסק
                (חובה — בלי הסכמה מתועדת אי אפשר להוסיף לרשימה)
              </span>
            </label>

            <Btn variant="primary" full className="mt-3" loading={saving} onClick={addContact} disabled={!canSubmit}>
              ➕ הוסף לרשימה
            </Btn>
            {!attested && (phone.trim() || email.trim()) ? (
              <div className="text-[11px] text-[#6B8FA8] mt-1.5 text-center">סמן את אישור ההסכמה כדי להוסיף</div>
            ) : null}
          </Card>

          <Card className="mb-3">
            <CardLabel>ייבוא CSV</CardLabel>
            <div className="text-[11px] text-[#6B8FA8] mb-2 leading-relaxed">
              עמודות נתמכות: full_name, phone, email, tags, consented_at, consent_source, consent_evidence, last_purchase_at.
              כפילויות מדולגות; מי שהוסר בעבר <b>לעולם לא</b> יוחזר לרשימה.
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="block w-full text-xs text-[#6B8FA8] mb-2" />
            <div className="space-y-2">
              <Select label="מקור הסכמה לכל הרשימה" value={csvSource} onChange={setCsvSource} options={CONSENT_SOURCE_OPTIONS} />
              <Input label="אסמכתא (אופציונלי)" value={csvEvidence} onChange={setCsvEvidence} placeholder="למשל: רשימת לקוחות מ-2025 שאישרו דיוור" />
            </div>
            <label className="flex items-start gap-2 mt-3 p-3 rounded-lg border border-[#1E2F42] bg-[#162030] cursor-pointer">
              <input type="checkbox" checked={csvAttested} onChange={e => setCsvAttested(e.target.checked)} className="mt-0.5" />
              <span className="text-[12px] text-[#D9E8F5] leading-relaxed">
                אני מאשר/ת שכל אנשי הקשר בקובץ נתנו <b>הסכמה מפורשת</b> לקבלת הודעות שיווקיות (חובה)
              </span>
            </label>
            <Btn variant="green" full className="mt-3" loading={importing} onClick={importCsv} disabled={!csvAttested || !activeClientId}>
              📥 ייבא קובץ
            </Btn>

            {importSummary && (
              <div className="mt-3 p-3 rounded-lg bg-[#111A24] border border-[#1E2F42] text-[12px] text-[#D9E8F5] space-y-1">
                <div className="font-semibold">תוצאות ייבוא ({importSummary.total} שורות)</div>
                <div className="text-[#34D399]">✓ נוספו: {importSummary.inserted}</div>
                {importSummary.skipped_duplicate > 0 && <div className="text-[#6B8FA8]">↷ כפילויות שדולגו: {importSummary.skipped_duplicate}</div>}
                {importSummary.skipped_opted_out > 0 && <div className="text-amber-400">🚫 הוסרו בעבר (לא הוחזרו): {importSummary.skipped_opted_out}</div>}
                {importSummary.rejected > 0 && <div className="text-red-400">✗ נדחו: {importSummary.rejected}</div>}
                {importErrors.map(r => (
                  <div key={r.index} className="text-[11px] text-red-400/80">שורה {r.index + 1}: {r.error}</div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── left column: the list ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-[#D9E8F5] font-semibold">
              {active.length} אנשי קשר עם הסכמה
              {activeClient ? <span className="text-[#6B8FA8] font-normal"> · {activeClient.name}</span> : null}
            </div>
            <Chip label={showOptedOut ? 'מציג גם הוסרו' : 'הצג גם הוסרו'} active={showOptedOut} onClick={() => setShowOptedOut(v => !v)} />
          </div>

          {loading ? (
            <div className="text-center py-16 text-[#6B8FA8] text-sm">טוען…</div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <div className="text-4xl mb-3 opacity-30">👥</div>
              <div className="text-sm">אין עדיין אנשי קשר — הוסף ידנית או ייבא CSV</div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
              {contacts.map(c => (
                <div key={c.id} className={`bg-[#111A24] border border-[#1E2F42] rounded-xl p-3 ${c.opted_out_at ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#D9E8F5] truncate">
                        {c.full_name || c.phone || c.email}
                        {c.opted_out_at && <span className="text-[10px] text-red-400 mr-2">· הוסר מהרשימה</span>}
                      </div>
                      <div className="text-[11px] text-[#6B8FA8] mt-0.5 truncate" dir="ltr" style={{ textAlign: 'right' }}>
                        {[c.phone, c.email].filter(Boolean).join(' · ')}
                      </div>
                      <div className="text-[10px] text-[#4A6A85] mt-1">
                        הסכמה: {CONSENT_LABELS[c.consent_source] ?? c.consent_source} · {new Date(c.consented_at).toLocaleDateString('he')}
                      </div>
                      {c.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {c.tags.map(t => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0A7AFF]/10 text-[#3D9FFF]">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {!c.opted_out_at && (
                      <Btn variant="ghost" size="sm" onClick={() => optOut(c)}>🚫 הסר</Btn>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
