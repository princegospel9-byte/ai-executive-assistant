import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PriorityBadge } from '@/components/email/priority-badge';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type SearchParams = {
  q?: string;
  category?: string;
  priority?: string;
  sender?: string;
};

export default async function EmailCenterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('emails')
    .select('id, from_address, from_name, subject, snippet, received_at, is_read, has_attachments, email_analysis(category, priority, summary, action_required, labels), draft_replies(id, status)')
    .order('received_at', { ascending: false })
    .limit(50);

  if (params.sender) query = query.ilike('from_address', `%${params.sender}%`);
  if (params.q) query = query.or(`subject.ilike.%${params.q}%,body_text.ilike.%${params.q}%`);

  const { data: emails, error } = await query;

  // email_analysis / draft_replies come back as arrays via PostgREST embedding
  // even though each is effectively 1:1 / 1:many-but-we-want-latest here.
  const rows = (emails ?? [])
    .map((e) => ({
      ...e,
      analysis: Array.isArray(e.email_analysis) ? e.email_analysis[0] : e.email_analysis,
      latestDraft: Array.isArray(e.draft_replies) ? e.draft_replies[e.draft_replies.length - 1] : e.draft_replies,
    }))
    .filter((e) => (params.category ? e.analysis?.category === params.category : true))
    .filter((e) => (params.priority ? e.analysis?.priority === params.priority : true));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Email Center</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {rows.length} email{rows.length === 1 ? '' : 's'} · updated as new mail is analyzed
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex-1 min-w-[180px] space-y-1.5">
          <label htmlFor="q" className="text-xs font-medium text-neutral-600">Keyword</label>
          <Input id="q" name="q" defaultValue={params.q} placeholder="Subject or body" />
        </div>
        <div className="flex-1 min-w-[180px] space-y-1.5">
          <label htmlFor="sender" className="text-xs font-medium text-neutral-600">Sender</label>
          <Input id="sender" name="sender" defaultValue={params.sender} placeholder="name@example.com" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="category" className="text-xs font-medium text-neutral-600">Category</label>
          <select
            id="category"
            name="category"
            defaultValue={params.category ?? ''}
            className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="">Any</option>
            <option value="SchoolPro GH Lead">SchoolPro GH Lead</option>
            <option value="Existing Client">Existing Client</option>
            <option value="Recruiter">Recruiter</option>
            <option value="Job Application">Job Application</option>
            <option value="Supplier">Supplier</option>
            <option value="Church">Church</option>
            <option value="Finance">Finance</option>
            <option value="Personal">Personal</option>
            <option value="Newsletter">Newsletter</option>
            <option value="Spam">Spam</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="priority" className="text-xs font-medium text-neutral-600">Priority</label>
          <select
            id="priority"
            name="priority"
            defaultValue={params.priority ?? ''}
            className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="">Any</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <Button type="submit">Filter</Button>
        {(params.q || params.sender || params.category || params.priority) && (
          <Link
            href="/email"
            className="inline-flex h-8 items-center rounded-lg border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Clear
          </Link>
        )}
      </form>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Couldn&apos;t load emails: {error.message}
        </p>
      )}

      {!error && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          No emails yet. Once Gmail is connected in n8n and the polling workflow runs, they&apos;ll appear here.
        </div>
      )}

      <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {rows.map((email) => (
          <Link
            key={email.id}
            href={`/email/${email.id}`}
            className="flex flex-col gap-2 px-4 py-3 hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`truncate text-sm ${email.is_read ? 'font-normal text-neutral-600' : 'font-semibold text-neutral-900'}`}>
                  {email.from_name || email.from_address}
                </span>
                {email.has_attachments && <span className="text-xs text-neutral-400">📎</span>}
              </div>
              <p className="truncate text-sm text-neutral-800">{email.subject || '(no subject)'}</p>
              <p className="truncate text-xs text-neutral-500">{email.analysis?.summary || email.snippet}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
              <PriorityBadge priority={email.analysis?.priority ?? null} />
              {email.analysis?.category && <Badge variant="secondary">{email.analysis.category}</Badge>}
              {email.latestDraft?.status === 'pending' && (
                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Draft needs review</Badge>
              )}
              <span className="text-xs text-neutral-400">
                {new Date(email.received_at).toLocaleDateString()}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}