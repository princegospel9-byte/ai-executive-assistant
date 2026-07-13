import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { computeHealthScore } from '@/lib/business/health-score';

const STAGE_LABELS: Record<string, string> = {
  new_lead: 'New Lead',
  contacted: 'Contacted',
  demo_scheduled: 'Demo Scheduled',
  demo_completed: 'Demo Completed',
  negotiating: 'Negotiating',
  trial_started: 'Trial Started',
  customer: 'Customer',
  lost_lead: 'Lost Lead',
};

const RISK_STYLES: Record<string, string> = {
  low: 'bg-neutral-100 text-neutral-600 hover:bg-neutral-100',
  medium: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  high: 'bg-red-100 text-red-800 hover:bg-red-100',
  critical: 'bg-red-200 text-red-900 hover:bg-red-200',
};

export default async function CommandCenterPage() {
  const supabase = await createClient();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const todayEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();

  const [
    { data: schools },
    { data: financeThisMonth },
    { count: tasksCompleted },
    { count: tasksPending },
    { data: todayEvents },
    { data: openRisks },
    { data: recentAgentOutputs },
    { data: goals },
    { data: metricsHistory },
  ] = await Promise.all([
    supabase.from('schools').select('id, status'),
    supabase.from('finance_entries').select('entry_type, amount, currency').gte('occurred_on', monthStart),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('updated_at', weekAgo),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']),
    supabase.from('calendar_events').select('id, title, start_time').eq('sync_status', 'synced').gte('start_time', todayStart).lte('start_time', todayEnd).order('start_time'),
    supabase.from('ai_insights').select('id, category, title, detail, severity').eq('status', 'new').order('created_at', { ascending: false }).limit(8),
    supabase.from('agent_outputs').select('id, status, created_at, agent_tasks(agents(name))').order('created_at', { ascending: false }).limit(8),
    supabase.from('company_goals').select('id, title, target_value, target_date, status').eq('status', 'active'),
    supabase.from('business_metrics').select('metric_date, income_total, expense_total').order('metric_date', { ascending: false }).limit(2),
  ]);

  const pipelineCounts: Record<string, number> = {};
  for (const s of schools ?? []) pipelineCounts[s.status] = (pipelineCounts[s.status] || 0) + 1;
  const customerCount = pipelineCounts.customer ?? 0;
  const activeLeadCount = (schools ?? []).filter((s) => s.status !== 'customer' && s.status !== 'lost_lead').length;
  const pendingProposals = pipelineCounts.negotiating ?? 0;

  const financeByCurrency: Record<string, { income: number; expenses: number }> = {};
  for (const e of financeThisMonth ?? []) {
    financeByCurrency[e.currency] ??= { income: 0, expenses: 0 };
    if (e.entry_type === 'income') financeByCurrency[e.currency].income += Number(e.amount);
    else financeByCurrency[e.currency].expenses += Number(e.amount);
  }

  let revenueTrendPct: number | null = null;
  if ((metricsHistory ?? []).length >= 2) {
    const [latest, prior] = metricsHistory!;
    if (prior.income_total > 0) {
      revenueTrendPct = Math.round(((latest.income_total - prior.income_total) / prior.income_total) * 100);
    }
  }

  const health = computeHealthScore({
    tasksCompleted: tasksCompleted ?? 0,
    tasksPending: tasksPending ?? 0,
    activeLeads: activeLeadCount,
    openRiskCount: (openRisks ?? []).length,
    revenueTrendPct,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Command Center</h1>
        <p className="mt-1 text-sm text-neutral-500">
          One screen pulling together what already exists across the system — nothing here is a new data source.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-2xl font-semibold text-neutral-900">{health.score}<span className="text-sm font-normal text-neutral-400">/100</span></p>
          <p className="text-xs text-neutral-500">Business health score</p>
          <div className="mt-2 space-y-1">
            {health.breakdown.map((b) => (
              <div key={b.label} className="flex items-center justify-between text-xs text-neutral-500">
                <span>{b.label}</span>
                <span>{b.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Revenue this month</p>
          {Object.keys(financeByCurrency).length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No entries logged yet — see /finance.</p>
          ) : (
            Object.entries(financeByCurrency).map(([currency, v]) => (
              <p key={currency} className="mt-1 text-lg font-semibold text-neutral-900">
                {currency} {(v.income - v.expenses).toFixed(2)}{' '}
                <span className="text-xs font-normal text-neutral-400">net</span>
              </p>
            ))
          )}
          {revenueTrendPct !== null && (
            <p className={`mt-1 text-xs ${revenueTrendPct >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {revenueTrendPct >= 0 ? '+' : ''}
              {revenueTrendPct}% vs. last snapshot
            </p>
          )}
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Pipeline</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">{customerCount} customers</p>
          <p className="text-xs text-neutral-500">{activeLeadCount} active leads · {pendingProposals} in negotiation</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Link href="/tasks" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{tasksPending ?? 0}</p>
          <p className="text-xs text-neutral-500">Open tasks</p>
        </Link>
        <Link href="/calendar" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{(todayEvents ?? []).length}</p>
          <p className="text-xs text-neutral-500">Meetings today</p>
        </Link>
        <Link href="/agents" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{(recentAgentOutputs ?? []).length}</p>
          <p className="text-xs text-neutral-500">Recent agent activity</p>
        </Link>
        <Link href="/goals" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{(goals ?? []).length}</p>
          <p className="text-xs text-neutral-500">Active goals</p>
        </Link>
      </div>

      <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-4 text-xs text-neutral-500">
        Customer satisfaction and team activity aren&apos;t shown — nothing in the system tracks either yet (no CSAT/NPS
        survey mechanism, and this is a solo-operator system with no team member records). Better to say so than show a
        fabricated number.
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Sales pipeline by stage</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(STAGE_LABELS).map(([key, label]) => (
            <Badge key={key} variant="secondary">
              {label}: {pipelineCounts[key] ?? 0}
            </Badge>
          ))}
        </div>
      </div>

      {openRisks && openRisks.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Risk alerts</h2>
          <div className="space-y-2">
            {openRisks.map((r) => (
              <div key={r.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                <div className="flex items-center gap-2">
                  <Badge className={RISK_STYLES[r.severity ?? 'low'] ?? RISK_STYLES.low}>{r.severity ?? r.category}</Badge>
                  <span className="text-sm font-medium text-neutral-900">{r.title}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-600">{r.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}