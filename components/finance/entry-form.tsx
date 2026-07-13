'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { addFinanceEntry } from '@/app/(dashboard)/finance/actions';

const CATEGORIES = {
  income: ['subscription_payment', 'one_time_sale', 'other_income'],
  expense: ['hosting', 'software_subscription', 'marketing', 'contractor', 'other_expense'],
};

export function EntryForm() {
  const [entryType, setEntryType] = useState<'income' | 'expense'>('income');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const amount = Number(formData.get('amount'));
    if (!amount || amount <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    startTransition(async () => {
      try {
        await addFinanceEntry({
          entry_type: entryType,
          category: String(formData.get('category')),
          amount,
          currency: String(formData.get('currency') || 'GHS'),
          description: String(formData.get('description') || '') || undefined,
          occurred_on: String(formData.get('occurred_on')),
        });
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Log an entry</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={entryType}
          onChange={(e) => setEntryType(e.target.value as 'income' | 'expense')}
          className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm"
        >
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <select name="category" required className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm">
          {CATEGORIES[entryType].map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input name="amount" type="number" step="0.01" min="0" placeholder="Amount" required className="h-9 w-28 rounded-md border border-neutral-300 bg-white px-3 text-sm" />
        <select name="currency" defaultValue="GHS" className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm">
          <option value="GHS">GHS</option>
          <option value="USD">USD</option>
        </select>
        <input name="occurred_on" type="date" required defaultValue={new Date().toISOString().split('T')[0]} className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm" />
        <input name="description" placeholder="Description (optional)" className="h-9 flex-1 min-w-[10rem] rounded-md border border-neutral-300 bg-white px-3 text-sm" />
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Add'}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}