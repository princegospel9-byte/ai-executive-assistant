-- Live Chat Auto-Reply history: every question a school admin asks in
-- SchoolPro GH's live chat, whether the AI answered it directly or
-- escalated to Prince, and why - a dashboard-visible log distinct from the
-- in-app notifications, which only fire for escalations. school_id and
-- session_id reference the SchoolPro GH project (a separate Supabase
-- project), not a local table, so no foreign keys here by design.
create table public.live_chat_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null,
  session_id text not null,
  sender_name text,
  question text not null,
  answer text not null, -- the AI's answer if auto-replied, or its internal reasoning note if escalated
  outcome text not null, -- 'auto_replied' | 'escalated'
  top_similarity numeric,
  created_at timestamptz not null default now()
);

create index live_chat_log_user_id_created_at_idx on public.live_chat_log(user_id, created_at desc);

alter table public.live_chat_log enable row level security;

create policy "Users view their own live chat log"
  on public.live_chat_log for select
  using (auth.uid() = user_id);
