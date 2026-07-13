'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { generateForecast, generateExecutiveReport } from '@/app/(dashboard)/reports/actions';

export function ReportActions() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleForecast() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await generateForecast();
        setMessage(`Forecast: ${result.predicted_value} (confidence: ${result.confidence})`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  function handleReport(type: 'quarterly' | 'annual') {
    setError(null);
    startTransition(async () => {
      try {
        await generateExecutiveReport(type);
        setMessage(`${type === 'quarterly' ? 'Quarterly' : 'Annual'} report generated below.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Generate on demand</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={handleForecast} disabled={isPending}>
          {isPending ? 'Working…' : 'Forecast next month’s revenue'}
        </Button>
        <Button variant="outline" onClick={() => handleReport('quarterly')} disabled={isPending}>
          Generate quarterly report
        </Button>
        <Button variant="outline" onClick={() => handleReport('annual')} disabled={isPending}>
          Generate annual report
        </Button>
      </div>
      {message && <p className="mt-2 text-xs text-neutral-600">{message}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}