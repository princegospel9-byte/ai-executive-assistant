'use client';

import { useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { PriorityBadge } from '@/components/email/priority-badge';
import { updateTaskStatus } from '@/app/(dashboard)/tasks/actions';

const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

export type Task = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  ai_priority_reason: string | null;
  ai_suggested: boolean;
};

export function TaskRow({ task }: { task: Task }) {
  const [isPending, startTransition] = useTransition();

  function handleStatusChange(status: string) {
    startTransition(async () => {
      await updateTaskStatus(task.id, status);
    });
  }

  const isDone = task.status === 'completed' || task.status === 'cancelled';

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-sm ${isDone ? 'text-neutral-400 line-through' : 'font-medium text-neutral-900'}`}>
            {task.title}
          </span>
          {task.ai_suggested && (
            <Badge variant="outline" className="text-[10px]">
              AI
            </Badge>
          )}
        </div>
        {task.description && <p className="mt-0.5 truncate text-xs text-neutral-500">{task.description}</p>}
        {task.ai_priority_reason && (
          <p className="mt-0.5 text-xs text-neutral-400">Why: {task.ai_priority_reason}</p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        <PriorityBadge priority={task.priority} />
        {task.category && <Badge variant="secondary">{task.category}</Badge>}
        {task.due_date && (
          <span className="text-xs text-neutral-500">{new Date(task.due_date).toLocaleString()}</span>
        )}
        <select
          value={task.status}
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={isPending}
          className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-xs capitalize disabled:opacity-50"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}