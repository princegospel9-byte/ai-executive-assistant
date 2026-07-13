import { createClient } from '@/lib/supabase/server';
import { GoalForm } from '@/components/goals/goal-form';
import { GoalCard } from '@/components/goals/goal-card';

export default async function GoalsPage() {
  const supabase = await createClient();

  const { data: goals } = await supabase
    .from('company_goals')
    .select('id, title, description, goal_type, target_value, target_date, status')
    .order('created_at', { ascending: false });

  const goalIds = (goals ?? []).map((g) => g.id);
  const { data: progressRows } = goalIds.length
    ? await supabase
        .from('goal_progress')
        .select('goal_id, current_value, note, recorded_at')
        .in('goal_id', goalIds)
        .order('recorded_at', { ascending: false })
    : { data: [] };

  const latestByGoal = new Map<string, { current_value: number | null; note: string | null; recorded_at: string }>();
  for (const row of progressRows ?? []) {
    if (!latestByGoal.has(row.goal_id)) latestByGoal.set(row.goal_id, row);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Goals</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Track progress toward business goals — customer-count goals are measured automatically from your CRM.
        </p>
      </div>

      <GoalForm />

      <div className="space-y-3">
        {(goals ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No goals yet — create one above.</p>
        ) : (
          (goals ?? []).map((g) => <GoalCard key={g.id} goal={{ ...g, latestProgress: latestByGoal.get(g.id) ?? null }} />)
        )}
      </div>
    </div>
  );
}