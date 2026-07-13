'use server';

import { createClient } from '@/lib/supabase/server';

export type SearchResult = { id: string; label: string; sublabel: string; href: string };
export type SearchResults = {
  schools: SearchResult[];
  tasks: SearchResult[];
  calendarEvents: SearchResult[];
  emails: SearchResult[];
  documents: SearchResult[];
};

export async function search(query: string): Promise<SearchResults> {
  const supabase = await createClient();
  const term = `%${query}%`;

  const [schools, tasks, events, emails, documents] = await Promise.all([
    supabase.from('schools').select('id, school_name, location').ilike('school_name', term).limit(10),
    supabase.from('tasks').select('id, title, status').ilike('title', term).limit(10),
    supabase.from('calendar_events').select('id, title, start_time').ilike('title', term).limit(10),
    supabase.from('emails').select('id, subject, from_name, from_address').ilike('subject', term).limit(10),
    supabase.from('knowledge_documents').select('id, filename, file_type').ilike('filename', term).limit(10),
  ]);

  const results: SearchResults = {
    schools: (schools.data ?? []).map((s) => ({ id: s.id, label: s.school_name, sublabel: s.location || '', href: `/school-sales/${s.id}` })),
    tasks: (tasks.data ?? []).map((t) => ({ id: t.id, label: t.title, sublabel: t.status, href: `/tasks` })),
    calendarEvents: (events.data ?? []).map((e) => ({
      id: e.id,
      label: e.title,
      sublabel: new Date(e.start_time).toLocaleDateString(),
      href: `/calendar`,
    })),
    emails: (emails.data ?? []).map((e) => ({
      id: e.id,
      label: e.subject || '(no subject)',
      sublabel: e.from_name || e.from_address,
      href: `/email/${e.id}`,
    })),
    documents: (documents.data ?? []).map((d) => ({ id: d.id, label: d.filename, sublabel: d.file_type.toUpperCase(), href: `/knowledge-base` })),
  };

  const totalCount = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('search_history').insert({ user_id: user.id, query, result_count: totalCount });
  }

  return results;
}