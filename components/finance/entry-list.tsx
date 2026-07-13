'use client';

import { useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { deleteFinanceEntry } from '@/app/(dashboard)/finance/actions';

type Entry = {
  id: string;
  entry_type: string;
  category: string;
  amount: number;
  currency: string;
  description: string | null;
  occurred_on: string;
};

export function EntryList({ entries }: { entries: Entry[] }) {
  const [isPending, startTransition] = useTransition();

  if (entries.length === 0) {
    return <p className="text-sm text-neutral-500">No entries logged yet.</p>;
  }

  return (
    <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
      {entries.map((e) => (
        <div key={e.id} className="flex items-center justify-between gap-2 px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge className={e.entry_type === 'income' ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-red-100 text-red-800 hover:bg-red-100'}>
                {e.entry_type}
              </Badge>
              <span className="text-sm font-medium text-neutral-900 capitalize">{e.category.replace(/_/g, ' ')}</span>
              <span className="text-sm text-neutral-600">
                {e.currency} {Number(e.amount).toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              {new Date(e.occurred_on).toLocaleDateString()}
              {e.description ? ` · ${e.description}` : ''}
            </p>
          </div>
          <Button variant="outline" onClick={() => startTransition(() => deleteFinanceEntry(e.id))} disabled={isPending}>
            Delete
          </Button>
        </div>
      ))}
    </div>
  );
}