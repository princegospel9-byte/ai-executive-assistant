import { createClient } from '@/lib/supabase/server';
import { NewEventForm } from '@/components/calendar/new-event-form';

type EventRow = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  location: string | null;
  meeting_link: string | null;
  attendees: string[];
};

function groupByDay(events: EventRow[]) {
  const groups = new Map<string, EventRow[]>();
  for (const event of events) {
    const day = new Date(event.start_time).toDateString();
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(event);
  }
  return groups;
}

export default async function CalendarPage() {
  const supabase = await createClient();

  const { data: events, error } = await supabase
    .from('calendar_events')
    .select('id, title, start_time, end_time, location, meeting_link, attendees')
    .eq('sync_status', 'synced')
    .gte('start_time', new Date(Date.now() - 86400000).toISOString())
    .order('start_time', { ascending: true })
    .limit(100);

  const grouped = groupByDay(events ?? []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Calendar</h1>
          <p className="mt-1 text-sm text-neutral-500">Agenda view — next 31 days, synced from Google Calendar</p>
        </div>
      </div>

      <NewEventForm />

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Couldn&apos;t load calendar: {error.message}
        </p>
      )}

      {!error && grouped.size === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          No upcoming events. Once Google Calendar is connected in n8n and syncing, they&apos;ll appear here.
        </div>
      )}

      <div className="space-y-4">
        {[...grouped.entries()].map(([day, dayEvents]) => (
          <div key={day} className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-semibold tracking-wide text-neutral-600 uppercase">
              {day}
            </div>
            <div className="divide-y divide-neutral-200">
              {dayEvents.map((event) => (
                <div key={event.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{event.title}</p>
                    {event.location && <p className="text-xs text-neutral-500">{event.location}</p>}
                    {event.attendees?.length > 0 && (
                      <p className="text-xs text-neutral-400">{event.attendees.join(', ')}</p>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {new Date(event.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
                    {new Date(event.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {event.meeting_link && (
                      <>
                        {' · '}
                        <a href={event.meeting_link} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                          Join
                        </a>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}