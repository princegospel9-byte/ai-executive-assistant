import { SearchBox } from '@/components/search/search-box';

export default function SearchPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Search</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Search across schools, tasks, calendar, emails, and documents — or ask the AI for a synthesized answer.
        </p>
      </div>
      <SearchBox />
    </div>
  );
}