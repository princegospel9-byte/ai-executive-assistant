import { createClient } from '@/lib/supabase/server';
import { LiveChatLogList } from '@/components/live-chat/live-chat-log-list';

export default async function LiveChatPage() {
  const supabase = await createClient();

  const { data: log } = await supabase
    .from('live_chat_log')
    .select('id, school_id, session_id, sender_name, question, answer, outcome, top_similarity, replied_at, prince_reply, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Live Chat</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every question a school admin has asked SchoolPro GH&apos;s live chat, whether the AI answered it directly or escalated it to you. Escalated conversations can be replied to directly below.
        </p>
      </div>

      <LiveChatLogList log={log ?? []} />
    </div>
  );
}
