import { createClient } from '@/lib/supabase/server';

export default async function DashboardHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
      <h1 className="text-xl font-semibold text-neutral-900">
        Welcome{user?.email ? `, ${user.email}` : ''}
      </h1>
      <p className="mt-2 text-sm text-neutral-500">
        Your daily briefing, key stats, and quick actions will appear here.
      </p>
      <p className="mt-4 inline-block rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-500">
        Coming in Phase 7 — Executive AI Agent
      </p>
    </div>
  );
}