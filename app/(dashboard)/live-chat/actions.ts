'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function sendManualReply(logId: string, schoolId: string, sessionId: string, message: string) {
  const url = process.env.SCHOOLHUB_AI_REPLY_URL;
  const secret = process.env.SCHOOLHUB_AI_REPLY_SECRET;
  if (!url || !secret) {
    throw new Error('SCHOOLHUB_AI_REPLY_URL / SCHOOLHUB_AI_REPLY_SECRET are not configured in .env.local.');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ai-reply-secret': secret,
    },
    body: JSON.stringify({ school_id: schoolId, session_id: sessionId, message, sender_name: 'KBrisks Support' }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ai-chat-reply failed (${response.status}): ${text}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('live_chat_log')
    .update({ replied_at: new Date().toISOString(), prince_reply: message })
    .eq('id', logId);
  if (error) throw new Error(error.message);

  revalidatePath('/live-chat');
}
