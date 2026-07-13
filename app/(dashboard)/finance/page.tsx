import { createClient } from '@/lib/supabase/server';
import { EntryForm } from '@/components/finance/entry-form';
import { EntryList } from '@/components/finance/entry-list';

export default async function FinancePage() {
  const supabase = await createClient();

  const { data: entries } = await supabase
    .from('finance_entries')
    .select('id, entry_type, category, amount, currency, description, occurred_on')
    .order('occurred_on', { ascending: false })
    .limit(100);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonth = (entries ?? []).filter((e) => new Date(e.occurred_on) >= monthStart);

  // Grouped by currency - summing different currencies together would silently produce a meaningless number.
  const byCurrency: Record<string, { income: number; expenses: number }> = {};
  for (const e of thisMonth) {
    byCurrency[e.currency] ??= { income: 0, expenses: 0 };
    if (e.entry_type === 'income') byCurrency[e.currency].income += Number(e.amount);
    else byCurrency[e.currency].expenses += Number(e.amount);
  }
  const currencies = Object.keys(byCurrency);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Finance</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Manual income/expense log — no bank or accounting integration. The Finance Agent and monthly business report both read from this.
        </p>
      </div>

      {currencies.length === 0 ? (
        <p className="text-sm text-neutral-500">No entries this month yet.</p>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${currencies.length}, minmax(0, 1fr))` }}>
          {currencies.map((currency) => (
            <div key={currency} className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-neutral-200 bg-white p-4">
                <p className="text-2xl font-semibold text-green-700">
                  {currency} {byCurrency[currency].income.toFixed(2)}
                </p>
                <p className="text-xs text-neutral-500">Income this month</p>
              </div>
              <div className="rounded-lg border border-neutral-200 bg-white p-4">
                <p className="text-2xl font-semibold text-red-700">
                  {currency} {byCurrency[currency].expenses.toFixed(2)}
                </p>
                <p className="text-xs text-neutral-500">Expenses this month</p>
              </div>
              <div className="rounded-lg border border-neutral-200 bg-white p-4">
                <p className="text-2xl font-semibold text-neutral-900">
                  {currency} {(byCurrency[currency].income - byCurrency[currency].expenses).toFixed(2)}
                </p>
                <p className="text-xs text-neutral-500">Net this month</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <EntryForm />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Entries</h2>
        <EntryList entries={entries ?? []} />
      </div>
    </div>
  );
}