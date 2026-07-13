import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { MeetingRecorder } from '@/components/voice/meeting-recorder';
import { DictationPanel } from '@/components/voice/dictation-panel';
import { PreferencesForm } from '@/components/voice/preferences-form';

const MEETING_STATUS_STYLES: Record<string, string> = {
  recording: 'bg-red-100 text-red-800 hover:bg-red-100',
  processing: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  ready: 'bg-green-100 text-green-800 hover:bg-green-100',
  failed: 'bg-neutral-100 text-neutral-600 hover:bg-neutral-100',
};

export default async function VoicePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: preferences }, { data: recentTranscripts }, { data: meetings }, { data: activity }] = await Promise.all([
    supabase.from('voice_preferences').select('voice_enabled, response_style, autoplay_briefing').eq('user_id', user!.id).maybeSingle(),
    supabase.from('voice_transcripts').select('role, content, created_at').order('created_at', { ascending: false }).limit(20),
    supabase
      .from('meeting_transcripts')
      .select('id, title, status, summary_text, action_items, next_meeting_date, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(10),
    supabase.from('activity_logs').select('id, action, description, created_at').order('created_at', { ascending: false }).limit(15),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Voice</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Microphone status, conversation history, meetings, and voice preferences. Voice conversation itself lives on
          the AI Advisor page — this is the control panel around it.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
        Microphone access is requested by your browser each time you tap Speak — nothing records without that prompt.
        Pending approvals (for anything an agent or the voice assistant proposed) live on the{' '}
        <a href="/agents" className="underline">
          Agent Team
        </a>{' '}
        page.
      </div>

      <PreferencesForm
        preferences={
          preferences ?? { voice_enabled: true, response_style: 'concise', autoplay_briefing: false }
        }
      />

      <MeetingRecorder />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Meeting summaries</h2>
        {(meetings ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No meetings recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {(meetings ?? []).map((m) => (
              <div key={m.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-900">{m.title}</span>
                    <Badge className={MEETING_STATUS_STYLES[m.status] ?? MEETING_STATUS_STYLES.processing}>{m.status}</Badge>
                  </div>
                  <span className="text-xs text-neutral-400">{new Date(m.occurred_at).toLocaleString()}</span>
                </div>
                {m.summary_text && <p className="mt-2 text-sm text-neutral-700">{m.summary_text}</p>}
                {Array.isArray(m.action_items) && m.action_items.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-xs text-neutral-600">
                    {m.action_items.map((a: { description: string }, i: number) => (
                      <li key={i}>{a.description}</li>
                    ))}
                  </ul>
                )}
                {m.next_meeting_date && (
                  <p className="mt-1 text-xs text-neutral-500">Next meeting: {new Date(m.next_meeting_date).toLocaleDateString()}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <DictationPanel />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Recent conversation</h2>
        {(recentTranscripts ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No voice conversation logged yet — enable Voice mode on the AI Advisor page.</p>
        ) : (
          <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
            {(recentTranscripts ?? []).map((t, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <Badge variant="secondary">{t.role}</Badge>
                  <span className="ml-2 text-sm text-neutral-700">{t.content.slice(0, 120)}</span>
                </div>
                <span className="shrink-0 text-xs text-neutral-400">{new Date(t.created_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">AI activity</h2>
        {(activity ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No activity logged yet.</p>
        ) : (
          <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
            {(activity ?? []).map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <span className="text-sm text-neutral-700">{a.description || a.action}</span>
                <span className="shrink-0 text-xs text-neutral-400">{new Date(a.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}