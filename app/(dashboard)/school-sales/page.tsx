import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ImportForm } from '@/components/school-sales/import-form';
import { InsightsPanel } from '@/components/school-sales/insights-panel';

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

const INTEREST_STYLES: Record<string, string> = {
  hot: 'bg-red-100 text-red-800 hover:bg-red-100',
  warm: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  cold: 'bg-neutral-100 text-neutral-600 hover:bg-neutral-100',
};

type SearchParams = { status?: string; q?: string };

export default async function SchoolSalesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('schools')
    .select('id, school_name, location, contact_person, status, interest_level, next_follow_up_date, updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);

  if (params.status) query = query.eq('status', params.status);
  if (params.q) query = query.ilike('school_name', `%${params.q}%`);

  const { data: schools, error } = await query;

  const counts: Record<string, number> = {};
  for (const s of schools ?? []) counts[s.status] = (counts[s.status] ?? 0) + 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">School Sales</h1>
        <p className="mt-1 text-sm text-neutral-500">SchoolPro GH pipeline — {(schools ?? []).length} lead{(schools ?? []).length === 1 ? '' : 's'}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ImportForm />
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Search school name"
            className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm"
          />
          <button type="submit" className="h-9 rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white">
            Search
          </button>
        </form>
      </div>

      <InsightsPanel />

      <div className="flex flex-wrap gap-2">
        <Link
          href="/school-sales"
          className={`rounded-full border px-3 py-1 text-xs font-medium ${!params.status ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50'}`}
        >
          All ({(schools ?? []).length})
        </Link>
        {Object.entries(STAGE_LABELS).map(([value, label]) => (
          <Link
            key={value}
            href={`/school-sales?status=${value}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${params.status === value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50'}`}
          >
            {label} ({counts[value] ?? 0})
          </Link>
        ))}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Couldn&apos;t load pipeline: {error.message}</p>
      )}

      {!error && (schools ?? []).length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          No schools yet — import a CSV list to get started.
        </div>
      )}

      <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {(schools ?? []).map((school) => (
          <Link
            key={school.id}
            href={`/school-sales/${school.id}`}
            className="flex flex-col gap-2 px-4 py-3 hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-900">{school.school_name}</p>
              <p className="text-xs text-neutral-500">
                {school.contact_person || 'No contact yet'}
                {school.location ? ` · ${school.location}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
              <Badge className={INTEREST_STYLES[school.interest_level] ?? INTEREST_STYLES.cold}>
                {school.interest_level}
              </Badge>
              <Badge variant="secondary">{STAGE_LABELS[school.status] ?? school.status}</Badge>
              {school.next_follow_up_date && (
                <span className="text-xs text-neutral-500">Follow up {new Date(school.next_follow_up_date).toLocaleDateString()}</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}