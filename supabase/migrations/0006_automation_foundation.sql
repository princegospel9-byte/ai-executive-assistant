-- Phase 2: tables written by n8n (via the service-role key, which bypasses
-- RLS entirely) and read by the dashboard (via the browser, where RLS is
-- what actually protects them). Deliberately no INSERT policy for the
-- `authenticated` role on any of these — a signed-in user can read their own
-- automation history but cannot fabricate a log/notification/approval row
-- from the browser. Only the service role (n8n) writes.

-- user_id is nullable here specifically because the global Error Handler
-- (triggered by n8n's system-level Error Trigger, not by the failed
-- workflow itself) only receives workflow name + error message - it has no
-- access to the failed workflow's own data, so it cannot know which user's
-- action failed. Well-behaved workflows still log their own failures with a
-- real user_id via their own failure branch; the Error Handler is the
-- catch-all for anything that didn't reach that point. See
-- documentation/n8n-automation-foundation.md for the full explanation.
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  workflow_name text not null,
  n8n_execution_id text,
  status text not null default 'running', -- 'running' | 'success' | 'failed'
  started_at timestamptz not null,
  finished_at timestamptz,
  duration_ms integer,
  error_message text,
  related_record_type text,
  related_record_id uuid,
  created_at timestamptz not null default now()
);

create index automation_runs_workflow_name_idx on public.automation_runs(workflow_name);
create index automation_runs_status_idx on public.automation_runs(status);
create index automation_runs_started_at_idx on public.automation_runs(started_at desc);

alter table public.automation_runs enable row level security;

-- Includes system-wide entries (user_id is null) alongside the user's own -
-- fine for a single-user account; revisit when a second real user exists.
create policy "Users view their own automation runs"
  on public.automation_runs for select
  using (user_id is null or auth.uid() = user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text,
  severity text not null default 'info', -- 'info' | 'warning' | 'critical'
  channel text not null default 'in_app', -- 'in_app' | 'email' | 'whatsapp' (only in_app actually delivers until those integrations exist)
  related_record_type text,
  related_record_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx on public.notifications(user_id, created_at desc);
create index notifications_read_at_idx on public.notifications(read_at);

alter table public.notifications enable row level security;

create policy "Users view their own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "Users can mark their own notifications read"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null, -- e.g. 'send_email' | 'create_calendar_event' | 'send_whatsapp' | 'update_crm_record'
  payload jsonb not null default '{}'::jsonb, -- the actual proposed action, shown to the user before they decide
  status text not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  related_record_type text,
  related_record_id uuid,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create index approvals_status_idx on public.approvals(status);
create index approvals_user_id_idx on public.approvals(user_id);

alter table public.approvals enable row level security;

create policy "Users view their own approvals"
  on public.approvals for select
  using (auth.uid() = user_id);

create policy "Users can decide on their own approvals"
  on public.approvals for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null, -- e.g. 'email_analysis' | 'daily_briefing'
  prompt_key text,
  prompt_version integer,
  model_used text not null,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(10,6),
  related_record_type text,
  related_record_id uuid,
  called_at timestamptz not null default now()
);

create index ai_usage_log_called_at_idx on public.ai_usage_log(called_at desc);
create index ai_usage_log_feature_idx on public.ai_usage_log(feature);

alter table public.ai_usage_log enable row level security;

create policy "Users view their own AI usage"
  on public.ai_usage_log for select
  using (auth.uid() = user_id);

-- Prompt library: not user-owned data, it's shared application config, so no
-- user_id column here. Any signed-in user may read it (harmless — it's not
-- sensitive), only the service role writes/versions it.
create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null,
  version integer not null default 1,
  category text not null, -- 'email_analysis' | 'email_reply' | 'crm_analysis' | 'follow_up_suggestions' | 'daily_briefing' | 'school_sales' | 'knowledge_search'
  system_prompt text not null,
  user_prompt_template text not null, -- {{variable}} placeholders, filled in by the AI - Process Request workflow
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (prompt_key, version)
);

-- Only one active version per prompt_key at a time, enforced by the database
-- itself, not by application discipline.
create unique index prompts_active_key_idx on public.prompts(prompt_key) where is_active;

alter table public.prompts enable row level security;

create policy "Authenticated users can read prompts"
  on public.prompts for select
  using (auth.role() = 'authenticated');