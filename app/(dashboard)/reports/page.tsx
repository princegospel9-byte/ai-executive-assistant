import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

export default async function ReportsPage() {
  const supabase = await createClient();

  const [{ data: weeklyReviews }, { data: monthlyReports }] = await Promise.all([
    supabase.from('weekly_reviews').select('id, week_start_date, content_text, created_at').order('week_start_date', { ascending: false }).limit(12),
    supabase.from('monthly_reports').select('id, period_start, period_end, content_text, created_at').order('period_start', { ascending: false }).limit(12),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Reports</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Weekly reviews (every Sunday) and monthly business reports (1st of each month), generated automatically.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Monthly business reports</h2>
        {(monthlyReports ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">None yet — the first one generates on the 1st of next month.</p>
        ) : (
          <div className="space-y-3">
            {(monthlyReports ?? []).map((r) => (
              <div key={r.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">
                    {new Date(r.period_start).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                  </Badge>
                  <span className="text-xs text-neutral-400">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{r.content_text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Weekly reviews</h2>
        {(weeklyReviews ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">None yet — the first one generates this Sunday.</p>
        ) : (
          <div className="space-y-3">
            {(weeklyReviews ?? []).map((r) => (
              <div key={r.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">Week of {new Date(r.week_start_date).toLocaleDateString()}</Badge>
                  <span className="text-xs text-neutral-400">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{r.content_text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}