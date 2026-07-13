'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { createGoal } from '@/app/(dashboard)/goals/actions';

export function GoalForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const title = String(formData.get('title') || '').trim();
    if (!title) {
      setError('Give the goal a title.');
      return;
    }
    startTransition(async () => {
      try {
        await createGoal({
          title,
          description: String(formData.get('description') || '') || undefined,
          goal_type: String(formData.get('goal_type') || 'custom'),
          target_value: formData.get('target_value') ? Number(formData.get('target_value')) : undefined,
          target_date: String(formData.get('target_date') || '') || undefined,
        });
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">New goal</h2>
      <div className="mt-3 space-y-2">
        <input name="title" placeholder="e.g. Acquire 50 schools" required className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm" />
        <textarea name="description" placeholder="Description (optional)" rows={2} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm" />
        <div className="flex flex-wrap gap-2">
          <select name="goal_type" defaultValue="custom" className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm">
            <option value="customer_count">Customer count (auto-tracked from CRM)</option>
            <option value="revenue">Revenue</option>
            <option value="custom">Custom</option>
          </select>
          <input name="target_value" type="number" step="0.01" placeholder="Target value" className="h-9 w-32 rounded-md border border-neutral-300 bg-white px-3 text-sm" />
          <input name="target_date" type="date" className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm" />
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Create goal'}
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}