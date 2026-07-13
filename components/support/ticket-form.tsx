'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { createTicket } from '@/app/(dashboard)/support/actions';

export function TicketForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const subject = String(formData.get('subject') || '').trim();
    const description = String(formData.get('description') || '').trim();
    if (!subject || !description) {
      setError('Subject and description are required.');
      return;
    }
    startTransition(async () => {
      try {
        await createTicket({
          subject,
          description,
          contact_email: String(formData.get('contact_email') || '') || undefined,
          priority: String(formData.get('priority') || 'medium'),
        });
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">New ticket</h2>
      <div className="mt-3 space-y-2">
        <input name="subject" placeholder="Subject" required className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm" />
        <textarea name="description" placeholder="Description" required rows={3} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm" />
        <div className="flex flex-wrap gap-2">
          <input name="contact_email" type="email" placeholder="Customer email (optional)" className="h-9 flex-1 min-w-[10rem] rounded-md border border-neutral-300 bg-white px-3 text-sm" />
          <select name="priority" defaultValue="medium" className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Create ticket'}
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}