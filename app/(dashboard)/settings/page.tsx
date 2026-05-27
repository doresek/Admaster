'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardLabel, Input, Btn, Alert, PageHeader, Tabs, Chip } from '@/components/ui';
import { FRAMEWORKS } from '@/lib/frameworks';

interface Settings {
  notif_approval:    boolean;
  notif_lead:        boolean;
  notif_series:      boolean;
  notif_credits_low: boolean;
  notif_billing:     boolean;
  notif_support:     boolean;
  notif_email:       boolean;
  theme:             'dark' | 'light';
  default_platform:  string;
  default_tone:      string;
  default_framework: string;
}

const PLATFORMS = [
  { id: 'facebook',  label: '📘 Facebook' },
  { id: 'instagram', label: '📸 Instagram' },
  { id: 'whatsapp',  label: '💬 WhatsApp' },
  { id: 'tiktok',    label: '🎵 TikTok' },
];

const TONES = ['חם ואישי','מקצועי','חסידי','דחיפות','סיפור'];

export default function SettingsPage() {
  const router = useRouter();
  const [tab,     setTab]     = useState<'profile' | 'notifications' | 'defaults' | 'danger'>('profile');
  const [profile, setProfile] = useState<{ id: string; name: string; email: string; plan: string; credits: number } | null>(null);
  const [s,       setS]       = useState<Settings | null>(null);
  const [name,    setName]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [saved,    setSaved]    = useState('');
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);

  async function load() {
    const res  = await fetch('/api/settings');
    const data = await res.json();
    if (data.profile)  { setProfile(data.profile); setName(data.profile.name || ''); }
    if (data.settings) setS(data.settings);
  }
  useEffect(() => { load(); }, []);

  async function saveProfileAndDefaults() {
    if (!s) return;
    setBusy(true); setError(''); setSaved('');
    try {
      const res = await fetch('/api/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, ...s }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setSaved('✅ ההגדרות נשמרו');
      setTimeout(() => setSaved(''), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function changePassword() {
    setError(''); setSaved('');
    if (password !== confirm)  { setError('הסיסמאות אינן זהות'); return; }
    if (password.length < 8)    { setError('הסיסמה חייבת להכיל לפחות 8 תווים'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setPassword(''); setConfirm('');
      setSaved('✅ הסיסמה עודכנה');
      setTimeout(() => setSaved(''), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function deleteAccount() {
    if (!confirm) return;
    const phrase = prompt('פעולה לא הפיכה. הקלד "מחק את החשבון שלי" כדי לאשר:');
    if (phrase !== 'מחק את החשבון שלי') return;
    setBusy(true);
    try {
      await fetch('/api/settings', { method: 'DELETE' });
      router.push('/login');
    } finally { setBusy(false); }
  }

  if (!profile || !s) {
    return <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>;
  }

  return (
    <div>
      <PageHeader eyebrow="⚙️ הגדרות" title="הגדרות החשבון" sub="פרופיל, סיסמה, התראות והעדפות ברירת מחדל" />

      {saved && <Alert type="green">{saved}</Alert>}
      {error && <Alert type="red">❌ {error}</Alert>}

      <Tabs
        active={tab}
        onChange={t => setTab(t as any)}
        tabs={[
          { id: 'profile',       label: '👤 פרופיל' },
          { id: 'notifications', label: '🔔 התראות' },
          { id: 'defaults',      label: '🎨 ברירות מחדל' },
          { id: 'danger',        label: '☠️ אזור סכנה' },
        ]}
      />

      {tab === 'profile' && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardLabel>פרטי חשבון</CardLabel>
            <Input label="שם מלא" value={name} onChange={setName} />
            <div className="mb-3">
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">אימייל</label>
              <div className="flex items-center justify-between bg-[#1A2A42] border border-[#243752] rounded-lg px-3 py-2.5">
                <span className="text-sm text-[#D9E8F5]" dir="ltr">{profile.email}</span>
                <span className="text-[10px] text-[#2E4459]">לא ניתן לשנות</span>
              </div>
            </div>
            <div className="flex items-center justify-between bg-[#1A2A42] rounded-lg px-3 py-2 mb-3">
              <span className="text-xs text-[#6B8FA8]">תוכנית</span>
              <span className="text-xs font-bold text-[#D4AF55]">{profile.plan}</span>
            </div>
            <div className="flex items-center justify-between bg-[#1A2A42] rounded-lg px-3 py-2 mb-3">
              <span className="text-xs text-[#6B8FA8]">יתרת קרדיטים</span>
              <span className="font-mono text-sm text-[#3D9FFF]">⚡ {profile.credits.toLocaleString()}</span>
            </div>
            <Btn variant="primary" full loading={busy} onClick={saveProfileAndDefaults}>💾 שמור פרופיל</Btn>
          </Card>

          <Card>
            <CardLabel>החלפת סיסמה</CardLabel>
            <Input label="סיסמה חדשה" value={password} onChange={setPassword} type="password" placeholder="לפחות 8 תווים" />
            <Input label="אימות סיסמה" value={confirm} onChange={setConfirm} type="password" />
            <Btn variant="primary" full loading={busy} onClick={changePassword} disabled={!password || !confirm}>
              🔑 שנה סיסמה
            </Btn>
          </Card>
        </div>
      )}

      {tab === 'notifications' && (
        <Card>
          <CardLabel>אילו התראות לקבל?</CardLabel>
          <div className="space-y-2">
            {[
              { k: 'notif_approval',    l: '✅ תגובות אישור מלקוחות' },
              { k: 'notif_lead',        l: '📋 לידים מדפי נחיתה' },
              { k: 'notif_series',      l: '🗓 התקדמות בסדרות מסרים' },
              { k: 'notif_credits_low', l: '⚠️ קרדיטים נמוכים' },
              { k: 'notif_billing',     l: '💳 אירועי חיוב' },
              { k: 'notif_support',     l: '🎫 תגובות מתמיכה' },
            ].map(opt => (
              <label key={opt.k} className="flex items-center justify-between bg-[#1A2A42] rounded-lg px-4 py-3 cursor-pointer hover:bg-[#22334D] transition-colors">
                <span className="text-sm">{opt.l}</span>
                <input type="checkbox" checked={(s as any)[opt.k]} onChange={e => setS({ ...s, [opt.k]: e.target.checked } as Settings)} className="w-4 h-4" />
              </label>
            ))}
          </div>
          <div className="border-t border-[#243752] mt-4 pt-4">
            <CardLabel>הגדרות נוספות</CardLabel>
            <label className="flex items-center justify-between bg-[#1A2A42] rounded-lg px-4 py-3 cursor-pointer">
              <span className="text-sm">📧 שלח כל התראה גם לאימייל</span>
              <input type="checkbox" checked={s.notif_email} onChange={e => setS({ ...s, notif_email: e.target.checked })} className="w-4 h-4" />
            </label>
          </div>
          <Btn variant="primary" full loading={busy} onClick={saveProfileAndDefaults} className="mt-4">💾 שמור התראות</Btn>
        </Card>
      )}

      {tab === 'defaults' && (
        <Card>
          <CardLabel>ברירות מחדל ליצירת תוכן</CardLabel>
          <div className="mb-3">
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">פלטפורמה ברירת מחדל</div>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map(p => (
                <Chip key={p.id} label={p.label} active={s.default_platform===p.id} onClick={() => setS({ ...s, default_platform: p.id })} />
              ))}
            </div>
          </div>
          <div className="mb-3">
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">טון ברירת מחדל</div>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map(t => (
                <Chip key={t} label={t} active={s.default_tone===t} onClick={() => setS({ ...s, default_tone: t })} />
              ))}
            </div>
          </div>
          <div className="mb-4">
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">Framework ברירת מחדל</div>
            <div className="flex flex-wrap gap-1.5">
              {FRAMEWORKS.map(f => (
                <Chip key={f.id} label={`${f.emoji} ${f.name_he.split('—')[0].trim()}`} active={s.default_framework===f.id} onClick={() => setS({ ...s, default_framework: f.id })} />
              ))}
            </div>
          </div>
          <Btn variant="primary" full loading={busy} onClick={saveProfileAndDefaults}>💾 שמור ברירות מחדל</Btn>
        </Card>
      )}

      {tab === 'danger' && (
        <Card style={{ borderColor: 'rgba(220,38,38,.3)' }}>
          <CardLabel>☠️ אזור סכנה</CardLabel>
          <Alert type="red">
            פעולת המחיקה תמחק לצמיתות: כל הבריפים, הלקוחות, התוכן שיצרת, הקרדיטים, ההיסטוריה. אי אפשר לשחזר.
          </Alert>
          <Btn variant="red" full onClick={deleteAccount} loading={busy}>🗑 מחק את החשבון שלי לצמיתות</Btn>
        </Card>
      )}
    </div>
  );
}
