import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

export default async function DashboardHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const today = new Date().toISOString().split('T')[0];

  const [{ data: briefing }, { count: pendingCount }, { count: todayEventCount }] = await Promise.all([
    supabase.from('daily_briefings').select('*').eq('briefing_date', today).maybeSingle(),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']),
    supabase
      .from('calendar_events')
      .select('id', { count: 'exact', head: true })
      .eq('sync_status', 'synced')
      .gte('start_time', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      .lte('start_time', new Date(new Date().setHours(23, 59, 59, 999)).toISOString()),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">
          Welcome{user?.email ? `, ${user.email}` : ''}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/tasks" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{pendingCount ?? 0}</p>
          <p className="text-xs text-neutral-500">Open tasks</p>
        </Link>
        <Link href="/calendar" className="rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <p className="text-2xl font-semibold text-neutral-900">{todayEventCount ?? 0}</p>
          <p className="text-xs text-neutral-500">Meetings today</p>
        </Link>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Today&apos;s briefing</h2>
          {briefing && <Badge variant="secondary">{new Date(briefing.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Badge>}
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