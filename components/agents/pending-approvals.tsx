'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { decideAgentOutput } from '@/app/(dashboard)/assistant/actions';

type PendingOutput = {
  id: string;
  agent_name: string;
  output_text: string;
  approval_id: string;
};

export function PendingApprovals({ outputs }: { outputs: PendingOutput[] }) {
  const [isPending, startTransition] = useTransition();
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function handleDecision(id: string, approvalId: string, decision: 'approved' | 'rejected') {
    setError(null);
    startTransition(async () => {
      try {
        await decideAgentOutput(approvalId, decision);
        setDecided((prev) => new Set(prev).add(id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  const remaining = outputs.filter((o) => !decided.has(o.id));

  if (remaining.length === 0) {
    return <p className="text-sm text-neutral-500">Nothing waiting for your approval.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {remaining.map((o) => (
        <div key={o.id} className="rounded-lg border border-neutral-200 bg-white p-4">
          <Badge variant="secondary">{o.agent_name}</Badge>
          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{o.output_text}</p>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => handleDecision(o.id, o.approval_id, 'approved')} disabled={isPending}>
              Approve
            </Button>
            <Button variant="outline" onClick={() => handleDecision(o.id, o.approval_id, 'rejected')} disabled={isPending}>
              Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}