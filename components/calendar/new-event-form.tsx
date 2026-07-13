'use client';

import { useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createEvent } from '@/app/(dashboard)/calendar/actions';

export function NewEventForm() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ title: string; start: string; end: string }[]>([]);

  function handleSubmit(formData: FormData) {
    const title = String(formData.get('title') || '');
    const date = String(formData.get('date') || '');
    const startTime = String(formData.get('start_time') || '');
    const endTime = String(formData.get('end_time') || '');
    const location = String(formData.get('location') || '');
    const notes = String(formData.get('notes') || '');
    const attendeesRaw = String(formData.get('attendees') || '');

    if (!title || !date || !startTime || !endTime) {
      setMessage('Title, date, start time, and end time are required.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await createEvent({
          title,
          start_time: new Date(`${date}T${startTime}`).toISOString(),
          end_time: new Date(`${date}T${endTime}`).toISOString(),
          location: location || undefined,
          notes: notes || undefined,
          attendees: attendeesRaw
            ? attendeesRaw.split(',').map((a) => a.trim()).filter(Boolean)
            : undefined,
        });
        setConflicts(result.conflicts ?? []);
        setMessage('Event created.');
        setOpen(false);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>New event</Button>
        {message && <p className="mt-2 text-xs text-neutral-500">{message}</p>}
        {conflicts.length > 0 && (
          <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Heads up — this overlaps with: {conflicts.map((c) => c.title).join(', ')}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New event</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="start_time">Start</Label>
              <Input id="start_time" name="start_time" type="time" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end_time">End</Label>
              <Input id="end_time" name="end_time" type="time" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" name="location" placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attendees">Attendees</Label>
            <Input id="attendees" name="attendees" placeholder="Comma-separated emails, optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={3} placeholder="Optional" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create event'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
          </div>
          {message && <p className="text-xs text-neutral-500">{message}</p>}
        </form>
      </CardContent>
    </Card>
  );
}