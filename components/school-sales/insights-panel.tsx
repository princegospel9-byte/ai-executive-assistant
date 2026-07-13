'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { generateInsights } from '@/app/(dashboard)/school-sales/actions';

export function InsightsPanel() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ insights: string; total_active: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await generateInsights();
        setResult(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">Sales insights</h2>
        <Button variant="outline" onClick={handleClick} disabled={isPending}>
          {isPending ? 'Analyzing…' : 'Generate insights'}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 whitespace-pre-wrap text-sm text-neutral-700">
          {result.insights}
        </div>
      )}
    </div>
  );
}