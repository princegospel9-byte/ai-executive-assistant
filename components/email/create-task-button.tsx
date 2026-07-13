'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { createTaskFromEmail } from '@/app/(dashboard)/tasks/actions';

export function CreateTaskButton({ emailId }: { emailId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await createTaskFromEmail(emailId);
        setMessage(`Task created: "${result.title}"`);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div>
      <Button variant="outline" onClick={handleClick} disabled={isPending}>
        {isPending ? 'Creating…' : 'Create task from this email'}
      </Button>
      {message && <p className="mt-1 text-xs text-neutral-500">{message}</p>}
    </div>
  );
}