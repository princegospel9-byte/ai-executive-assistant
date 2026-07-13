import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ListenButton } from '@/components/voice/listen-button';

const INSIGHT_STYLES: Record<string, string> = {
  risk: 'bg-red-100 text-red-800 hover:bg-red-100',
  opportunity: 'bg-green-100 text-green-800 hover:bg-green-100',
  recommendation: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
};

export default async function DashboardHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const today = new Date().toISOString().split('T')[0];

  const [
    { data: briefing },
    { count: pendingCount },
    { count: todayEventCount },
    { count: customerCount },
    { count: activeLeadCount },
    { count: documentCount },
    { data: insights },
  ] = await Promise.all([
    supabase.from('daily_briefings').select('*').eq('briefing_date', today).maybeSingle(),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']),
    supabase
      .from('calendar_events')
      .select('id', { count: 'exact', head: true })
      .eq('sync_status', 'synced')
      .gte('start_time', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      .lte('start_time', new Date(new Date().setHours(23, 59, 59, 999)).toISOString()),
    supabase.from('schools').select('id', { count: 'exact', head: true }).eq('status', 'customer'),
    supabase.from('schools').select('id', { count: 'exact', head: true }).not('status', 'in', '(customer,lost_lead)'),
    supabase.from('knowledge_documents').select('id', { count: 'exact', head: true }).eq('status', 'ready'),
    supabase.from('ai_insights').select('id, category, title, detail, status').eq('status', 'new').order('created_at', { ascending: false }).limit(6),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">
          Welcome{user?.email ? `, ${user.email}` : ''}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Link href="/tasks" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{pendingCount ?? 0}</p>
          <p className="text-xs text-neutral-500">Open tasks</p>
        </Link>
        <Link href="/calendar" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{todayEventCount ?? 0}</p>
          <p className="text-xs text-neutral-500">Meetings today</p>
        </Link>
        <Link href="/school-sales" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{customerCount ?? 0}</p>
          <p className="text-xs text-neutral-500">Customers</p>
        </Link>
        <Link href="/school-sales" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{activeLeadCount ?? 0}</p>
          <p className="text-xs text-neutral-500">Active leads</p>
        </Link>
        <Link href="/knowledge-base" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{documentCount ?? 0}</p>
          <p className="text-xs text-neutral-500">Documents ready</p>
        </Link>
      </div>

      {insights && insights.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">AI insights</h2>
          <div className="mt-3 space-y-2">
            {insights.map((i) => (
              <div key={i.id} className="flex items-start gap-2">
                <Badge className={INSIGHT_STYLES[i.category] ?? INSIGHT_STYLES.recommendation}>{i.category}</Badge>
                <div>
                  <p className="text-sm font-medium text-neutral-900">{i.title}</p>
                  <p className="text-xs text-neutral-600">{i.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Today&apos;s briefing</h2>
          <div className="flex items-center gap-2">
            {briefing && <ListenButton text={briefing.content_text} />}
            {briefing && <Badge variant="secondary">{new Date(briefing.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Badge>}
          </div>
        </div>

        {briefing ? (
          <div className="mt-3 whitespace-pre-wrap text-sm text-neutral-700">{briefing.content_text}</div>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">
            No briefing yet today — it&apos;s generated automatically at 6:00 AM. Once the Briefing - Daily Morning
            Briefing workflow has run at least once, it&apos;ll appear here.
          </p>
        )}
      </div>
    </div>
  );
}