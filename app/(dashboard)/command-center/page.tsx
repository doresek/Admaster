'use client';
// Command Center — the owner sees and controls ALL marketing (campaigns, spend,
// performance) AND the understanding behind every decision (grounded insights +
// rationale). The WHY is the product. Read-heavy; the only writes are status
// changes (pause/resume/approve) which NEVER trigger live spend.
//
// Renders gracefully when migration 030 is unapplied: the APIs return empty
// payloads and this page shows an empty state instead of failing.
import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Alert, StatCard } from '@/components/ui';
import { CampaignCard, DiagnosesSection, EmptyState } from './components';
import type { Campaign, Diagnosis } from '@/app/api/command-center/shared';

function useCommandCenter() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [cRes, dRes] = await Promise.all([
        fetch('/api/command-center/campaigns'),
        fetch('/api/command-center/diagnoses'),
      ]);
      const cData = await cRes.json().catch(() => ({}));
      const dData = await dRes.json().catch(() => ({}));
      // Absent-table-safe: treat any non-array / error payload as "nothing yet".
      setCampaigns(cRes.ok && Array.isArray(cData.campaigns) ? cData.campaigns : []);
      setDiagnoses(dRes.ok && Array.isArray(dData.diagnoses) ? dData.diagnoses : []);
    } catch {
      // Network or parse failure — render the empty state, not a crash.
      setCampaigns([]);
      setDiagnoses([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Optimistic status flip after a successful PATCH (no live spend involved).
  const patch = useCallback(async (id: string, action: 'pause' | 'resume' | 'approve') => {
    const res = await fetch(`/api/command-center/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'שגיאה בעדכון הקמפיין');
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status: data.status } : c)));
  }, []);

  return { campaigns, diagnoses, loading, err, setErr, patch };
}

export default function CommandCenterPage() {
  const { campaigns, diagnoses, loading, err, setErr, patch } = useCommandCenter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onAction(id: string, action: 'pause' | 'resume' | 'approve') {
    setBusyId(id);
    setErr('');
    try {
      await patch(id, action);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const active = campaigns.filter((c) => c.status === 'active').length;
  const dryRun = campaigns.filter((c) => c.dry_run).length;
  const totalBudget = campaigns
    .filter((c) => c.status === 'active' && c.daily_budget != null)
    .reduce((s, c) => s + Number(c.daily_budget), 0);

  return (
    <div>
      <PageHeader
        eyebrow="חדר בקרה"
        title="מרכז השליטה"
        sub="כל הקמפיינים, התקציב והביצועים — ולמה כל החלטה התקבלה"
      />

      {err && <Alert type="red">{err}</Alert>}

      {!loading && campaigns.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon="📣" value={campaigns.length} label="קמפיינים" />
          <StatCard icon="🟢" value={active} label="פעילים" glow="rgba(5,150,105,0.14)" />
          <StatCard icon="₪" value={`₪${totalBudget.toLocaleString('he-IL')}`} label="תקציב יומי פעיל" />
          <StatCard icon="🧪" value={dryRun} label="בהרצה יבשה" glow="rgba(184,149,58,0.14)" />
        </div>
      )}

      {loading && (
        <div className="text-center py-14 text-[#6B8FA8] text-sm">טוען…</div>
      )}

      {!loading && campaigns.length === 0 && (
        <EmptyState
          icon="📣"
          title="אין קמפיינים עדיין"
          sub="כשהמערכת תייצר קמפיינים הם יופיעו כאן — יחד עם ההסבר וההיגיון מאחורי כל החלטה."
        />
      )}

      {!loading && campaigns.length > 0 && (
        <div className="space-y-4">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              busy={busyId === c.id}
              onAction={(action) => onAction(c.id, action)}
            />
          ))}
        </div>
      )}

      {!loading && <DiagnosesSection diagnoses={diagnoses} />}
    </div>
  );
}
