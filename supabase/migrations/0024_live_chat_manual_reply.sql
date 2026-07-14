-- Lets Prince reply to an escalated live chat conversation directly from
-- the Assistant dashboard (via the same ai-chat-reply edge function n8n
-- uses for automatic replies), and tracks that it's been handled.
alter table public.live_chat_log
  add column if not exists replied_at timestamptz,
  add column if not exists prince_reply text;
