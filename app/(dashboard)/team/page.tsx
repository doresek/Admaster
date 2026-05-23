'use client';
import { useState, useEffect } from 'react';
import { Card, CardLabel, Input, Btn, Alert, PageHeader } from '@/components/ui';

const ROLES = [
  { id:'admin',  label:'Admin',  desc:'גישה מלאה', color:'#DC2626' },
  { id:'agent',  label:'Agent',  desc:'יוצר תוכן, לא billing', color:'#0A7AFF' },
  { id:'viewer', label:'Viewer', desc:'קריאה בלבד', color:'#6B8FA8' },
];

const PLAN_LIMITS: Record<string, number> = { free:0, starter:2, pro:5, agency:20 };

export default function TeamPage() {
  const [members, setMembers] = useState<any[]>([]);
  const [plan,    setPlan]    = useState('free');
  const [form,    setForm]    = useState({ email:'', name:'', role:'agent' });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetch('/api/team').then(r=>r.json()).then(d=>setMembers(Array.isArray(d)?d:[]));
    // get plan
    import('@/lib/supabase/client').then(({ createClient }) => {
      const s = createClient();
      s.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        s.from('users').select('plan').eq('id', user.id).single().then(({ data }) => setPlan(data?.plan||'free'));
      });
    });
  }, []);

  const limit = PLAN_LIMITS[plan] ?? 0;

  async function invite() {
    if (!form.email) return;
    setLoading(true); setError(''); setSuccess('');
    const res  = await fetch('/api/team', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setLoading(false); return; }
    setMembers(p=>[...p,data]);
    setForm({ email:'', name:'', role:'agent' });
    setSuccess(`✅ ${form.email} הוזמן בהצלחה!`);
    setLoading(false);
  }

  async function removeMember(id: string) {
    await fetch(`/api/team?id=${id}`, { method:'DELETE' });
    setMembers(p=>p.filter(m=>m.id!==id));
  }

  async function changeRole(id: string, role: string) {
    await fetch('/api/team', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, role }) });
    setMembers(p=>p.map(m=>m.id===id?{...m,role}:m));
  }

  const statusColor: Record<string, string> = { active:'#059669', pending:'#D97706', inactive:'#6B8FA8' };

  return (
    <div>
      <PageHeader eyebrow="צוות" title="ניהול צוות" sub={`${members.length}/${limit} חברי צוות`} />

      {plan === 'free' && (
        <Alert type="amber">⚠️ תוכנית חינמית לא כוללת חברי צוות — <a href="/credits" className="font-bold underline">שדרג ל-Starter</a></Alert>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          {limit > 0 && (
            <Card className="mb-3">
              <CardLabel>הזמן חבר צוות</CardLabel>
              <Input label="אימייל *" value={form.email} onChange={v=>setForm(p=>({...p,email:v}))} placeholder="agent@example.com" />
              <Input label="שם (אופציונלי)" value={form.name} onChange={v=>setForm(p=>({...p,name:v}))} placeholder="שם החבר" />
              <div className="mb-3">
                <label className="block text-xs font-medium text-[#6B8FA8] mb-2">תפקיד</label>
                <div className="flex gap-2">
                  {ROLES.map(r=>(
                    <button key={r.id} onClick={()=>setForm(p=>({...p,role:r.id}))}
                      className={`flex-1 p-2.5 rounded-lg border text-center transition-all ${form.role===r.id?`border-[${r.color}] bg-[${r.color}]/10`:'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]'}`}
                      style={{ borderColor: form.role===r.id ? r.color : '', background: form.role===r.id ? `${r.color}18` : '' }}>
                      <div className="text-xs font-bold" style={{ color: form.role===r.id ? r.color : '#6B8FA8' }}>{r.label}</div>
                      <div className="text-[10px] text-[#2E4459] mt-0.5">{r.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              {error   && <Alert type="red">{error}</Alert>}
              {success && <Alert type="green">{success}</Alert>}
              <Btn variant="primary" loading={loading} onClick={invite} disabled={!form.email||members.length>=limit}>
                ✉️ שלח הזמנה
              </Btn>
            </Card>
          )}

          <Card>
            <CardLabel>הרשאות לפי תפקיד</CardLabel>
            {[
              ['יצירת תוכן','✅','✅','👁'],
              ['ניהול לקוחות','✅','✅','👁'],
              ['ניהול קמפיינים','✅','✅','❌'],
              ['דוחות','✅','✅','✅'],
              ['פרסום','✅','✅','❌'],
              ['קרדיטים / תשלום','✅','❌','❌'],
              ['הגדרות Billing','✅','❌','❌'],
            ].map(([f,a,ag,v])=>(
              <div key={f} className="grid grid-cols-4 gap-2 py-1.5 border-b border-[#1E2F42] last:border-0 text-xs">
                <div className="text-[#6B8FA8]">{f}</div>
                <div className="text-center">{a}</div>
                <div className="text-center">{ag}</div>
                <div className="text-center">{v}</div>
              </div>
            ))}
            <div className="grid grid-cols-4 gap-2 pt-2 text-[10px] font-bold text-[#2E4459]">
              <div/><div className="text-center text-[#DC2626]">Admin</div><div className="text-center text-[#0A7AFF]">Agent</div><div className="text-center text-[#6B8FA8]">Viewer</div>
            </div>
          </Card>
        </div>

        <div>
          {members.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <span className="text-4xl mb-3 opacity-30">👥</span>
              <span className="text-sm">אין חברי צוות עדיין</span>
            </div>
          ) : (
            <Card>
              <CardLabel>חברי צוות ({members.length}/{limit})</CardLabel>
              {members.map(m=>(
                <div key={m.id} className="flex items-center gap-3 py-3 border-b border-[#1E2F42] last:border-0">
                  <div className="w-8 h-8 rounded-full bg-[#1D2D3E] flex items-center justify-center text-sm font-bold">
                    {(m.name||m.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{m.name||m.email}</div>
                    <div className="text-[11px] text-[#2E4459] truncate">{m.email}</div>
                  </div>
                  <select value={m.role} onChange={e=>changeRole(m.id,e.target.value)}
                    className="text-[11px] bg-[#162030] border border-[#1E2F42] rounded-lg px-2 py-1 outline-none text-[#D9E8F5]">
                    {ROLES.map(r=><option key={r.id} value={r.id} className="bg-[#162030]">{r.label}</option>)}
                  </select>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor[m.status]||'#6B8FA8' }} />
                  <button onClick={()=>removeMember(m.id)} className="text-[#2E4459] hover:text-red-400 text-xs">✕</button>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
