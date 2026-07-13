'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { refreshCustomerMemory } from '@/app/(dashboard)/school-sales/actions';

type CustomerMemory = {
  summary: string | null;
  preferences: string | null;
  last_updated: string;
} | null;

export function CustomerKnowledgePanel({ schoolId, memory }: { schoolId: string; memory: CustomerMemory }) {
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(memory);
  const [nextAction, setNextAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRefresh() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await refreshCustomerMemory(schoolId);
        setCurrent({ summary: result.summary, preferences: result.preferences, last_updated: new Date().toISOString() });
        setNextAction(result.recommended_next_action);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">Customer knowledge</h2>
        <Button variant="outline" onClick={handleRefresh} disabled={isPending}>
          {isPending ? 'Refreshing…' : 'Refresh AI summary'}
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {current?.summary ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-neutral-700">{current.summary}</p>
          {current.preferences && <p className="text-xs text-neutral-500">Preferences: {current.preferences}</p>}
          {nextAction && <p className="text-xs font-medium text-neutral-700">Recommended next action: {nextAction}</p>}
          <p className="text-xs text-neutral-400">Last updated {new Date(current.last_updated).toLocaleString()}</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-neutral-500">
          No AI summary yet — generate a message for this school or click &quot;Refresh AI summary&quot; to build one.
        </p>
      )}
    </div>
  );
}