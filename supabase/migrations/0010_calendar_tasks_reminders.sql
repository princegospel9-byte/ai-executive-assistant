-- Phase 4: extends tasks/reminders from Phase 1, adds calendar_events (only
-- ever sketched in the original blueprint, never actually built), and the
-- recurring task / activity log / briefing tables Phase 4 needs.

-- ── tasks: extend + align status/priority vocabulary ────────────────────
alter table public.tasks
  add column category text,
  add column reminder_at timestamptz,
  add column related_email_id uuid references public.emails(id) on delete set null,
  add column notes text,
  add column ai_priority_reason text,
  add column ai_suggested boolean not null default false;

-- Data migration for any rows created under the old vocabulary (harmless
-- no-op if the tables are still empty, which they likely are).
update public.tasks set status = 'pending' where status = 'todo';
update public.tasks set status = 'completed' where status = 'done';

comment on column public.tasks.status is 'pending | in_progress | completed | cancelled';
comment on column public.tasks.priority is 'critical | high | medium | low';

create index tasks_category_idx on public.tasks(category);
create index tasks_related_email_id_idx on public.tasks(related_email_id);

-- ── calendar_events ──────────────────────────────────────────────────────
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_event_id text, -- Google Calendar event id; null for app-only events not yet synced
  title text not null,
  description text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  location text,
  meeting_link text,
  attendees text[] not null default '{}',
  notes text,
  sync_status text not null default 'synced', -- 'synced' | 'pending_sync' | 'removed'
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, external_event_id)
);

create index calendar_events_start_time_idx on public.calendar_events(start_time);
create index calendar_events_user_id_idx on public.calendar_events(user_id);

alter table public.calendar_events enable row level security;

create policy "Users manage their own calendar events"
  on public.calendar_events for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── reminders: generalize beyond tasks (documented in 0004 as the point to
-- do this once there's a second target type - calendar events are that) ──
alter table public.reminders
  add column calendar_event_id uuid references public.calendar_events(id) on delete cascade,
  add constraint reminders_single_target_check
    check (num_nonnulls(task_id, calendar_event_id) <= 1);

create index reminders_calendar_event_id_idx on public.reminders(calendar_event_id);

-- ── recurring_tasks ───────────────────────────────────────────────────────
create table public.recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  category text,
  priority text not null default 'medium',
  recurrence_type text not null, -- 'daily' | 'weekly' | 'monthly'
  recurrence_day integer, -- 0-6 (Sun-Sat) for weekly, 1-31 for monthly, null for daily
  recurrence_time time not null default '09:00',
  is_active boolean not null default true,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create index recurring_tasks_next_run_at_idx on public.recurring_tasks(next_run_at) where is_active;

alter table public.recurring_tasks enable row level security;

create policy "Users manage their own recurring tasks"
  on public.recurring_tasks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── activity_logs: user-facing "what happened" trail, distinct from
-- automation_runs (workflow health) - this is for a future Activity feed,
-- not debugging ─────────────────────────────────────────────────────────
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null, -- e.g. 'task_completed', 'event_created', 'reminder_sent'
  entity_type text,
  entity_id uuid,
  description text,
  created_at timestamptz not null default now()
);

create index activity_logs_user_id_created_at_idx on public.activity_logs(user_id, created_at desc);

alter table public.activity_logs enable row level security;

create policy "Users view their own activity log"
  on public.activity_logs for select
  using (auth.uid() = user_id);

-- ── daily_briefings / weekly_reviews ──────────────────────────────────────
create table public.daily_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  briefing_date date not null,
  content_text text not null,
  content_json jsonb,
  sent_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, briefing_date)
);

alter table public.daily_briefings enable row level security;

create policy "Users view their own daily briefings"
  on public.daily_briefings for select
  using (auth.uid() = user_id);

create policy "Users can mark their own briefings viewed"
  on public.daily_briefings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start_date date not null,
  content_text text not null,
  content_json jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, week_start_date)
);

alter table public.weekly_reviews enable row level security;

create policy "Users view their own weekly reviews"
  on public.weekly_reviews for select
  using (auth.uid() = user_id);