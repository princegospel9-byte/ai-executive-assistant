'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { search, type SearchResults } from '@/app/(dashboard)/search/actions';
import { askAdvisor } from '@/app/(dashboard)/assistant/actions';

const SECTIONS: { key: keyof SearchResults; label: string }[] = [
  { key: 'schools', label: 'Schools' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'calendarEvents', label: 'Calendar events' },
  { key: 'emails', label: 'Emails' },
  { key: 'documents', label: 'Documents' },
];

export function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [aiAnswer, setAiAnswer] = useState<{ answer: string; sources: string[] } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isAsking, startAsking] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setError(null);
    setAiAnswer(null);
    startTransition(async () => {
      try {
        setResults(await search(query.trim()));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  function handleAskAI() {
    if (!query.trim()) return;
    setError(null);
    startAsking(async () => {
      try {
        const result = await askAdvisor(query.trim());
        setAiAnswer({ answer: result.answer, sources: result.sources });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  const totalResults = results ? Object.values(results).reduce((sum, arr) => sum + arr.length, 0) : 0;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search schools, tasks, emails, documents…"
          className="h-10 flex-1 rounded-md border border-neutral-300 bg-white px-3 text-sm"
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Searching…' : 'Search'}
        </Button>
        <Button type="button" variant="outline" onClick={handleAskAI} disabled={isAsking}>
          {isAsking ? 'Asking…' : 'Ask AI instead'}
        </Button>
      </form>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {aiAnswer && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="whitespace-pre-wrap text-sm text-neutral-700">{aiAnswer.answer}</p>
          {aiAnswer.sources.length > 0 && (
            <p className="mt-2 text-xs text-neutral-500">Sources: {aiAnswer.sources.join(', ')}</p>
          )}
        </div>
      )}

      {results && (
        <div className="space-y-4">
          {totalResults === 0 && <p className="text-sm text-neutral-500">No matches — try &quot;Ask AI instead&quot; for a synthesized answer.</p>}
          {SECTIONS.map(({ key, label }) => {
            const items = results[key];
            if (items.length === 0) return null;
            return (
              <div key={key}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</h3>
                <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
                  {items.map((item) => (
                    <Link key={item.id} href={item.href} className="flex items-center justify-between px-4 py-2 hover:bg-neutral-50">
                      <span className="text-sm text-neutral-900">{item.label}</span>
                      <span className="text-xs text-neutral-500">{item.sublabel}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}