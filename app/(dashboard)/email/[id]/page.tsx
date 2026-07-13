import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PriorityBadge } from '@/components/email/priority-badge';
import { Badge } from '@/components/ui/badge';
import { DraftPanel } from '@/components/email/draft-panel';
import { CreateTaskButton } from '@/components/email/create-task-button';

type Attachment = {
  id: string;
  filename: string;
  mime_type: string | null;
  ai_summary: string | null;
};

export default async function EmailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: email } = await supabase
    .from('emails')
    .select('*, email_analysis(*), email_attachments(*)')
    .eq('id', id)
    .single();

  if (!email) notFound();

  const { data: drafts } = await supabase
    .from('draft_replies')
    .select('id, tone, draft_text, edited_text, status, approval_id, approvals(status)')
    .eq('email_id', id)
    .order('generated_at', { ascending: false });

  const latestDraft = drafts?.[0] ?? null;
  const analysis = Array.isArray(email.email_analysis) ? email.email_analysis[0] : email.email_analysis;
  const attachments: Attachment[] = email.email_attachments ?? [];
  const labels: string[] = analysis?.labels ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/email" className="text-sm text-neutral-500 hover:underline">
        &larr; Back to Email Center
      </Link>

      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        <div className="flex flex-wrap items-center gap-2">
          {analysis?.priority && <PriorityBadge priority={analysis.priority} />}
          {analysis?.category && <Badge variant="secondary">{analysis.category}</Badge>}
          {labels.map((label) => (
            <Badge key={label} variant="outline">
              {label}
            </Badge>
          ))}
        </div>

        <h1 className="mt-3 text-lg font-semibold text-neutral-900">{email.subject || '(no subject)'}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          From {email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address} ·{' '}
          {new Date(email.received_at).toLocaleString()}
        </p>

        {analysis && (
          <div className="mt-4 space-y-2 rounded-md bg-neutral-50 p-4 text-sm text-neutral-700">
            <p>
              <span className="font-medium text-neutral-900">Summary:</span> {analysis.summary}
            </p>
            {analysis.priority_reason && (
              <p>
                <span className="font-medium text-neutral-900">Why this priority:</span> {analysis.priority_reason}
              </p>
            )}
            {analysis.suggested_next_step && (
              <p>
                <span className="font-medium text-neutral-900">Suggested next step:</span>{' '}
                {analysis.suggested_next_step}
              </p>
            )}
            {analysis.suggested_deadline && (
              <p>
                <span className="font-medium text-neutral-900">Suggested deadline:</span>{' '}
                {analysis.suggested_deadline}
              </p>
            )}
            {analysis.action_required && (
              <div className="pt-1">
                <CreateTaskButton emailId={email.id} />
              </div>
            )}
          </div>
        )}

        <div className="mt-4 whitespace-pre-wrap text-sm text-neutral-800">
          {email.body_text || email.snippet}
        </div>

        {attachments.length > 0 && (
          <div className="mt-4 border-t border-neutral-200 pt-4">
            <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Attachments</p>
            <ul className="mt-2 space-y-1 text-sm">
              {attachments.map((a) => (
                <li key={a.id} className="text-neutral-700">
                  {a.filename} <span className="text-neutral-400">({a.mime_type})</span>
                  {a.ai_summary && <span className="block text-xs text-neutral-500">{a.ai_summary}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <DraftPanel emailId={email.id} draft={latestDraft} />
    </div>
  );
}