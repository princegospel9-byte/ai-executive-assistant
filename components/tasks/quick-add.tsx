'use client';

import { useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createTaskFromText } from '@/app/(dashboard)/tasks/actions';

export function QuickAdd() {
  const [text, setText] = useState('');
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    startTransition(async () => {
      try {
        const result = await createTaskFromText(text.trim());
        setMessage(
          result.kind === 'recurring_task'
            ? `Recurring task created: "${result.title}"`
            : `Task created: "${result.title}"`
        );
        setText('');
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-neutral-200 bg-white p-4">
      <label htmlFor="quick-add" className="text-xs font-medium text-neutral-600">
        Add a task in plain English
      </label>
      <div className="mt-1.5 flex gap-2">
        <Input
          id="quick-add"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "Call ABC School tomorrow afternoon" or "Remind me every Monday to check sales leads"'
          disabled={isPending}
        />
        <Button type="submit" disabled={isPending || !text.trim()}>
          {isPending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {message && <p className="mt-2 text-xs text-neutral-500">{message}</p>}
    </form>
  );
}