'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { upsertMemory, deleteMemory } from '@/app/(dashboard)/knowledge-base/actions';

const CATEGORIES = ['product', 'pricing', 'strategy', 'preference', 'goal', 'challenge', 'revenue'] as const;

type MemoryItem = {
  id: string;
  category: string;
  key: string;
  value: string;
};

export function MemoryPanel({ memory }: { memory: MemoryItem[] }) {
  const [isPending, startTransition] = useTransition();
  const [category, setCategory] = useState<string>('product');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    if (!key.trim() || !value.trim()) {
      setError('Both a label and a value are required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await upsertMemory(category, key.trim(), value.trim());
        setKey('');
        setValue('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(() => deleteMemory(id));
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Business memory</h2>
      <p className="mt-1 text-xs text-neutral-500">
        What the AI always knows about your business — products, pricing, strategy, goals, working preferences. Revenue can be
        logged manually here too (e.g. category &quot;revenue&quot;, label &quot;2026-07&quot;, value &quot;GHS 4,200&quot;) since there&apos;s no
        invoicing system yet to pull it from automatically.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm capitalize"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Label (e.g. Parent portal price)"
          className="h-9 flex-1 min-w-[10rem] rounded-md border border-neutral-300 bg-white px-3 text-sm"
        />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          className="h-9 flex-1 min-w-[10rem] rounded-md border border-neutral-300 bg-white px-3 text-sm"
        />
        <Button onClick={handleAdd} disabled={isPending}>
          Save
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-4 divide-y divide-neutral-200">
        {memory.length === 0 && <p className="py-2 text-xs text-neutral-500">Nothing saved yet.</p>}
        {memory.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="capitalize">
                  {m.category}
                </Badge>
                <span className="text-sm font-medium text-neutral-900">{m.key}</span>
              </div>
              <p className="mt-0.5 text-sm text-neutral-600">{m.value}</p>
            </div>
            <Button variant="outline" onClick={() => handleDelete(m.id)} disabled={isPending}>
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}