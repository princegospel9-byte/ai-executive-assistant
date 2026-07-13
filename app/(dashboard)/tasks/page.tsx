import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { QuickAdd } from '@/components/tasks/quick-add';
import { TaskRow } from '@/components/tasks/task-row';

type SearchParams = { status?: string; priority?: string };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('tasks')
    .select('id, title, description, category, priority, status, due_date, ai_priority_reason, ai_suggested')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(100);

  query = params.status ? query.eq('status', params.status) : query.not('status', 'in', '(completed,cancelled)');
  if (params.priority) query = query.eq('priority', params.priority);

  const { data: tasks, error } = await query;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Tasks</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {(tasks ?? []).length} task{(tasks ?? []).length === 1 ? '' : 's'}
        </p>
      </div>

      <QuickAdd />

      <div className="flex flex-wrap items-center gap-2">
        {[
          { label: 'Active', href: '/tasks' },
          { label: 'Pending', href: '/tasks?status=pending' },
          { label: 'In progress', href: '/tasks?status=in_progress' },
          { label: 'Completed', href: '/tasks?status=completed' },
          { label: 'Cancelled', href: '/tasks?status=cancelled' },
        ].map((f) => (
          <Link
            key={f.label}
            href={f.href}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              (f.href === '/tasks' && !params.status) || params.status === f.href.split('status=')[1]
                ? 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Couldn&apos;t load tasks: {error.message}
        </p>
      )}

      {!error && (tasks ?? []).length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Nothing here. Add one above, or it&apos;ll fill in automatically from emails and your recurring tasks.
        </div>
      )}

      <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {(tasks ?? []).map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}