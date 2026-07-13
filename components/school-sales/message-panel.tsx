'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  approveMessage,
  generateMessage,
  markWhatsAppSent,
  rejectMessage,
} from '@/app/(dashboard)/school-sales/actions';

const MESSAGE_TYPES = [
  ['introduction', 'Introduction'],
  ['demo_invitation', 'Demo invitation'],
  ['follow_up', 'Follow-up'],
  ['pricing', 'Pricing'],
  ['trial_activation', 'Trial activation'],
  ['support_reply', 'Support reply'],
] as const;

type Draft = {
  message_id: string;
  channel: string;
  subject: string | null;
  content: string;
  approval_id: string | null;
};

export function MessagePanel({ schoolId }: { schoolId: string }) {
  const [messageType, setMessageType] = useState('follow_up');
  const [channel, setChannel] = useState('whatsapp');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await generateMessage(schoolId, messageType, channel);
        setDraft(result);
        setStatus(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  function handleCopy() {
    if (!draft) return;
    navigator.clipboard.writeText(draft.content);
    setStatus('Copied to clipboard.');
  }

  function handleMarkSent() {
    if (!draft) return;
    startTransition(async () => {
      await markWhatsAppSent(draft.message_id, schoolId);
      setStatus('Marked as sent.');
    });
  }

  function handleApprove() {
    if (!draft?.approval_id) return;
    setError(null);
    startTransition(async () => {
      try {
        await approveMessage(draft.approval_id!, schoolId);
        setStatus('Approved — sending now.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  function handleReject() {
    if (!draft?.approval_id) return;
    setError(null);
    startTransition(async () => {
      try {
        await rejectMessage(draft.approval_id!, schoolId);
        setStatus('Rejected — this draft will not be sent.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Generate a message</h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={messageType}
          onChange={(e) => setMessageType(e.target.value)}
          className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm"
        >
          {MESSAGE_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm"
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </select>
        <Button onClick={handleGenerate} disabled={isPending}>
          {isPending ? 'Generating…' : 'Generate'}
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {draft && (
        <div className="mt-4 rounded-md bg-neutral-50 p-4">
          <div className="flex items-center justify-between">
            <Badge variant="secondary">{draft.channel}</Badge>
            {status && <span className="text-xs text-neutral-500">{status}</span>}
          </div>
          {draft.subject && <p className="mt-2 text-sm font-medium text-neutral-900">{draft.subject}</p>}
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{draft.content}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {draft.channel === 'whatsapp' ? (
              <>
                <Button variant="outline" onClick={handleCopy}>
                  Copy text
                </Button>
                <Button variant="outline" onClick={handleMarkSent} disabled={isPending}>
                  Mark as sent
                </Button>
              </>
            ) : draft.approval_id ? (
              <>
                <Button onClick={handleApprove} disabled={isPending}>
                  Approve &amp; send
                </Button>
                <Button variant="outline" onClick={handleReject} disabled={isPending}>
                  Reject
                </Button>
              </>
            ) : (
              <p className="text-xs text-neutral-500">
                This email couldn&apos;t be linked to an approval record — try generating it again.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}