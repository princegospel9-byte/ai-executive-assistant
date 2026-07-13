-- Phase 8: AI Voice & Multimodal Executive Assistant. Voice conversation
-- reuses the EXISTING orchestration layer (Agent - Orchestrate Request,
-- KB - Answer Question, Core - Request Approval) - this migration only adds
-- what's genuinely new: audio/session bookkeeping, meeting records, image
-- uploads, and voice-specific preferences. One deviation from the spec's
-- literal table list, same reasoning as every prior phase - see
-- documentation/voice-multimodal-module.md:
--   - no separate approval_requests table: this is exactly what `approvals`
--     (Phase 3) already is. Voice approvals ("yes, send it") call the same
--     existing approval-decision webhooks, just triggered by a spoken
--     "yes"/"no" instead of a button click.
--   - meeting_summaries merged into meeting_transcripts (1:1, a join for
--     no reason).
--   - PDF/DOCX/XLSX/CSV uploads reuse knowledge_documents (Phase 6) -
--     uploaded_media below is for images specifically, the one media type
--     that had no home yet.

-- ── voice_sessions ────────────────────────────────────────────────────────
create table public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'conversation', -- 'conversation' | 'dictation' | 'meeting'
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index voice_sessions_user_id_idx on public.voice_sessions(user_id);

alter table public.voice_sessions enable row level security;

create policy "Users manage their own voice sessions"
  on public.voice_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── voice_transcripts (per-turn, within a session) ──────────────────────
create table public.voice_transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.voice_sessions(id) on delete cascade,
  role text not null, -- 'user' | 'assistant'
  content text not null,
  created_at timestamptz not null default now()
);

create index voice_transcripts_session_id_idx on public.voice_transcripts(session_id);

alter table public.voice_transcripts enable row level security;

create policy "Users manage their own voice transcripts"
  on public.voice_transcripts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── meeting_transcripts (transcript + summary + action items in one row) ─
create table public.meeting_transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  audio_storage_path text,
  transcript_text text,
  summary_text text,
  decisions text,
  action_items jsonb not null default '[]'::jsonb, -- [{ description, task_id }]
  next_meeting_date date,
  status text not null default 'recording', -- 'recording' | 'processing' | 'ready' | 'failed'
  error_message text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index meeting_transcripts_user_id_occurred_at_idx on public.meeting_transcripts(user_id, occurred_at desc);

alter table public.meeting_transcripts enable row level security;

create policy "Users manage their own meeting transcripts"
  on public.meeting_transcripts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── uploaded_media (images - documents already have knowledge_documents) ─
create table public.uploaded_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  media_type text not null default 'image',
  description text, -- AI-generated caption, feeds universal search
  status text not null default 'processing', -- 'processing' | 'ready' | 'failed'
  error_message text,
  created_at timestamptz not null default now()
);

create index uploaded_media_user_id_idx on public.uploaded_media(user_id);

alter table public.uploaded_media enable row level security;

create policy "Users manage their own uploaded media"
  on public.uploaded_media for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── voice_preferences (one row per user) ─────────────────────────────────
create table public.voice_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  voice_enabled boolean not null default true,
  elevenlabs_voice_id text,
  response_style text not null default 'concise', -- 'concise' | 'detailed'
  autoplay_briefing boolean not null default false,
  retain_recordings_days integer not null default 30,
  updated_at timestamptz not null default now()
);

alter table public.voice_preferences enable row level security;

create policy "Users manage their own voice preferences"
  on public.voice_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── conversation_memory (session-scoped rolling context - distinct from
-- business_memory (Phase 6, long-term business facts) and agent_memory
-- (Phase 7, per-agent learned preference) ────────────────────────────────
create table public.conversation_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.voice_sessions(id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now()
);

create index conversation_memory_session_id_idx on public.conversation_memory(session_id);

alter table public.conversation_memory enable row level security;

create policy "Users manage their own conversation memory"
  on public.conversation_memory for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Storage: private buckets for meeting audio and uploaded images ───────
insert into storage.buckets (id, name, public)
values ('voice-recordings', 'voice-recordings', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('uploaded-media', 'uploaded-media', false)
on conflict (id) do nothing;

create policy "Users manage their own voice recordings in storage"
  on storage.objects for all
  using (bucket_id = 'voice-recordings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'voice-recordings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users manage their own uploaded media in storage"
  on storage.objects for all
  using (bucket_id = 'uploaded-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'uploaded-media' and (storage.foldername(name))[1] = auth.uid()::text);