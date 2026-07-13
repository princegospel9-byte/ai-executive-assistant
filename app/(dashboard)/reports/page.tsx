import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ReportActions } from '@/components/reports/report-actions';

const CONFIDENCE_STYLES: Record<string, string> = {
  low: 'bg-neutral-100 text-neutral-600 hover:bg-neutral-100',
  medium: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  high: 'bg-green-100 text-green-800 hover:bg-green-100',
};

export default async function ReportsPage() {
  const supabase = await createClient();

  const [{ data: weeklyReviews }, { data: monthlyReports }, { data: executiveReports }, { data: predictions }] = await Promise.all([
    supabase.from('weekly_reviews').select('id, week_start_date, content_text, created_at').order('week_start_date', { ascending: false }).limit(12),
    supabase.from('monthly_reports').select('id, period_start, period_end, content_text, created_at').order('period_start', { ascending: false }).limit(12),
    supabase.from('executive_reports').select('id, report_type, period_start, period_end, content_text, created_at').order('period_start', { ascending: false }).limit(8),
    supabase.from('business_predictions').select('id, prediction_type, period_label, predicted_value, confidence, reasoning, created_at').order('created_at', { ascending: false }).limit(6),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Reports</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Daily briefings (on the dashboard home), weekly reviews, monthly/quarterly/annual reports, and revenue
          forecasts — all generated automatically, or on demand below.
        </p>
      </div>

      <ReportActions />

      {predictions && predictions.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Forecasts</h2>
          <p className="mb-2 text-xs text-neutral-500">
            Claude&apos;s trend reasoning over your logged history — not a statistical model. Treat as a starting point, not a guarantee.
          </p>
          <div className="space-y-2">
            {predictions.map((p) => (
              <div key={p.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{p.prediction_type}</Badge>
                  <Badge className={CONFIDENCE_STYLES[p.confidence] ?? CONFIDENCE_STYLES.low}>{p.confidence} confidence</Badge>
                  <span className="text-xs text-neutral-400">{p.period_label}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-neutral-900">{p.predicted_value}</p>
                <p className="mt-1 text-xs text-neutral-600">{p.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {executiveReports && executiveReports.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Quarterly / annual reports</h2>
          <div className="space-y-3">
            {executiveReports.map((r) => (
              <div key={r.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">{r.report_type}</Badge>
                  <span className="text-xs text-neutral-400">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{r.content_text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

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