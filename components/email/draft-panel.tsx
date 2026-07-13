'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { approveDraft, editDraft, regenerateDraft, rejectDraft } from '@/app/(dashboard)/email/actions';

const TONES = ['professional', 'friendly', 'formal', 'short', 'detailed'] as const;

type ApprovalRef = { status: string } | { status: string }[] | null;

export type Draft = {
  id: string;
  tone: string;
  draft_text: string;
  edited_text: string | null;
  status: string;
  approval_id: string | null;
  approvals: ApprovalRef;
} | null;

export function DraftPanel({ emailId, draft }: { emailId: string; draft: Draft }) {
  const [tone, setTone] = useState(draft?.tone ?? 'professional');
  const [text, setText] = useState(draft?.edited_text ?? draft?.draft_text ?? '');
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const isActionable = draft?.status === 'pending';

  function handleSaveEdit() {
    if (!draft) return;
    startTransition(async () => {
      await editDraft(draft.id, text);
      setMessage('Edit saved.');
    });
  }

  function handleApprove() {
    if (!draft?.approval_id) return;
    startTransition(async () => {
      await approveDraft(draft.approval_id!, emailId);
      setMessage('Approved and sent.');
    });
  }

  function handleReject() {
    if (!draft?.approval_id) return;
    startTransition(async () => {
      await rejectDraft(draft.approval_id!, emailId);
      setMessage('Draft rejected.');
    });
  }

  function handleRegenerate() {
    startTransition(async () => {
      await regenerateDraft(emailId, tone);
      setMessage('New draft requested — refresh in a few seconds to see it.');
    });
  }

  if (!draft) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        <p className="text-sm text-neutral-500">No draft yet for this email.</p>
        <div className="mt-3 flex items-center gap-2">
          <ToneSelect value={tone} onChange={setTone} disabled={isPending} />
          <Button onClick={handleRegenerate} disabled={isPending}>
            Generate draft
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">Draft reply</h2>
        <Badge variant={draft.status === 'sent' ? 'default' : draft.status === 'rejected' ? 'destructive' : 'secondary'}>
          {draft.status}
        </Badge>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!isActionable || isPending}
        rows={8}
        className="mt-3"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ToneSelect value={tone} onChange={setTone} disabled={!isActionable || isPending} />

        {isActionable && (
          <>
            <Button variant="outline" onClick={handleSaveEdit} disabled={isPending}>
              Save edit
            </Button>
            <Button variant="outline" onClick={handleRegenerate} disabled={isPending}>
              Regenerate
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={isPending}>
              Reject
            </Button>
            <Button onClick={handleApprove} disabled={isPending}>
              Approve &amp; send
            </Button>
          </>
        )}
      </div>

      {message && <p className="mt-2 text-xs text-neutral-500">{message}</p>}
    </div>
  );
}

function ToneSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (tone: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm capitalize disabled:opacity-50"
    >
      {TONES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}