'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { sendManualReply } from '@/app/(dashboard)/live-chat/actions';

type LogEntry = {
  id: string;
  school_id: string;
  session_id: string;
  sender_name: string | null;
  question: string;
  answer: string;
  outcome: string;
  top_similarity: number | null;
  replied_at: string | null;
  prince_reply: string | null;
  created_at: string;
};

const OUTCOME_STYLES: Record<string, string> = {
  auto_replied: 'bg-green-100 text-green-800 hover:bg-green-100',
  escalated: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
};

export function LiveChatLogList({ log }: { log: LogEntry[] }) {
  const [isPending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function handleSend(entry: LogEntry) {
    const message = (drafts[entry.id] ?? '').trim();
    if (!message) return;
    setError(null);
    startTransition(async () => {
      try {
        await sendManualReply(entry.id, entry.school_id, entry.session_id, message);
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[entry.id];
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  if (log.length === 0) {
    return <p className="text-sm text-neutral-500">No live chat activity yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {log.map((entry) => {
        const needsReply = entry.outcome === 'escalated' && !entry.replied_at;
        return (
          <div key={entry.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className={OUTCOME_STYLES[entry.outcome] ?? 'bg-neutral-100 text-neutral-600'}>
                  {entry.outcome === 'auto_replied' ? 'Auto-replied' : entry.replied_at ? 'Replied' : 'Escalated'}
                </Badge>
                {entry.sender_name && <span className="text-sm font-medium text-neutral-900">{entry.sender_name}</span>}
              </div>
              <span className="text-xs text-neutral-400">{new Date(entry.created_at).toLocaleString()}</span>
            </div>
            <p className="mt-2 text-sm text-neutral-800">{entry.question}</p>
            <div className="mt-2 rounded-md bg-neutral-50 p-3">
              <p className="whitespace-pre-wrap text-sm text-neutral-700">{entry.answer}</p>
            </div>
            {entry.top_similarity != null && (
              <p className="mt-1 text-xs text-neutral-400">Match confidence: {(entry.top_similarity * 100).toFixed(0)}%</p>
            )}

            {entry.replied_at && entry.prince_reply && (
              <div className="mt-2 rounded-md bg-blue-50 p-3">
                <p className="text-xs font-medium text-blue-900">Your reply (sent as &quot;KBrisks Support&quot;):</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-blue-800">{entry.prince_reply}</p>
              </div>
            )}

            {needsReply && (
              <div className="mt-3 space-y-2">
                <Textarea
                  placeholder="Type your reply to send back through the live chat..."
                  value={drafts[entry.id] ?? ''}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                  disabled={isPending}
                  className="min-h-20"
                />
                <Button onClick={() => handleSend(entry)} disabled={isPending || !(drafts[entry.id] ?? '').trim()}>
                  {isPending ? 'Sending…' : 'Send reply'}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
