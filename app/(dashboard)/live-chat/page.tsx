import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

const OUTCOME_STYLES: Record<string, string> = {
  auto_replied: 'bg-green-100 text-green-800 hover:bg-green-100',
  escalated: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
};

export default async function LiveChatPage() {
  const supabase = await createClient();

  const { data: log } = await supabase
    .from('live_chat_log')
    .select('id, session_id, sender_name, question, answer, outcome, top_similarity, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Live Chat</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every question a school admin has asked SchoolPro GH&apos;s live chat, whether the AI answered it directly or escalated it to you.
        </p>
      </div>

      {(!log || log.length === 0) ? (
        <p className="text-sm text-neutral-500">No live chat activity yet.</p>
      ) : (
        <div className="space-y-3">
          {log.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge className={OUTCOME_STYLES[entry.outcome] ?? 'bg-neutral-100 text-neutral-600'}>
                    {entry.outcome === 'auto_replied' ? 'Auto-replied' : 'Escalated'}
                  </Badge>
                  {entry.sender_name && <span className="text-sm font-medium text-neutral-900">{entry.sender_name}</span>}
                </div>
                <span className="text-xs text-neutral-400">{new Date(entry.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-2 text-sm text-neutral-800">{entry.question}</p>
              <div className="mt-2 rounded-md bg-neutral-50 p-3">
                <p className="whitespace-pre-wrap text-sm text-neutral-700">{entry.answer}</p>
              </div>
              {entry.top_similarity != null && (
                <p className="mt-1 text-xs text-neutral-400">Match confidence: {(entry.top_similarity * 100).toFixed(0)}%</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
