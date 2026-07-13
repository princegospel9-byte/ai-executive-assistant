'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { closeTicket, draftReply, decideSupportReply } from '@/app/(dashboard)/support/actions';

type Ticket = {
  id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  contact_email: string | null;
  draft_response: string | null;
  approval_id: string | null;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  awaiting_approval: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  resolved: 'bg-green-100 text-green-800 hover:bg-green-100',
  closed: 'bg-neutral-100 text-neutral-600 hover:bg-neutral-100',
};

export function TicketList({ tickets }: { tickets: Ticket[] }) {
  const [isPending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, { draft_reply: string; approval_id: string }>>({});
  const [error, setError] = useState<string | null>(null);

  function handleDraft(ticketId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await draftReply(ticketId);
        setDrafts((prev) => ({ ...prev, [ticketId]: { draft_reply: result.draft_reply, approval_id: result.approval_id } }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  function handleDecision(ticketId: string, approvalId: string, decision: 'approved' | 'rejected') {
    setError(null);
    startTransition(async () => {
      try {
        await decideSupportReply(approvalId, decision);
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[ticketId];
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  if (tickets.length === 0) {
    return <p className="text-sm text-neutral-500">No tickets yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {tickets.map((t) => {
        const localDraft = drafts[t.id];
        const showDraft = localDraft || (t.status === 'awaiting_approval' && t.draft_response);
        return (
          <div key={t.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className={STATUS_STYLES[t.status] ?? STATUS_STYLES.open}>{t.status.replace('_', ' ')}</Badge>
                <span className="text-sm font-medium text-neutral-900">{t.subject}</span>
                <Badge variant="secondary">{t.priority}</Badge>
              </div>
              <span className="text-xs text-neutral-400">{new Date(t.created_at).toLocaleDateString()}</span>
            </div>
            <p className="mt-1 text-sm text-neutral-600">{t.description}</p>
            {t.contact_email && <p className="mt-1 text-xs text-neutral-500">From: {t.contact_email}</p>}

            {showDraft && (
              <div className="mt-2 rounded-md bg-neutral-50 p-3">
                <p className="whitespace-pre-wrap text-sm text-neutral-700">{localDraft?.draft_reply || t.draft_response}</p>
                {(localDraft?.approval_id || t.approval_id) && t.status !== 'resolved' && t.status !== 'closed' && (
                  <div className="mt-2 flex gap-2">
                    <Button onClick={() => handleDecision(t.id, localDraft?.approval_id || t.approval_id!, 'approved')} disabled={isPending}>
                      Approve &amp; send
                    </Button>
                    <Button variant="outline" onClick={() => handleDecision(t.id, localDraft?.approval_id || t.approval_id!, 'rejected')} disabled={isPending}>
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            )}

            {t.status === 'open' && !localDraft && (
              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={() => handleDraft(t.id)} disabled={isPending || !t.contact_email}>
                  {isPending ? 'Drafting…' : 'Draft AI reply'}
                </Button>
                <Button variant="outline" onClick={() => startTransition(() => closeTicket(t.id))} disabled={isPending}>
                  Close without reply
                </Button>
                {!t.contact_email && <span className="text-xs text-neutral-400 self-center">No contact email - can&apos;t send a reply</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}