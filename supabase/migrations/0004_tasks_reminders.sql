create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium', -- 'low' | 'medium' | 'high'
  status text not null default 'todo', -- 'todo' | 'in_progress' | 'done' | 'cancelled'
  due_date timestamptz,
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_status_idx on public.tasks(status);
create index tasks_due_date_idx on public.tasks(due_date);
create index tasks_user_id_idx on public.tasks(user_id);

alter table public.tasks enable row level security;

create policy "Users manage their own tasks"
  on public.tasks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A reminder targets a task for now. It's deliberately not polymorphic yet —
-- when reminders need to target calendar events or other record types in a
-- later phase, add a nullable target_type/target_id pair instead of forcing
-- that generality in before there's a second use case for it.
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  remind_at timestamptz not null,
  notification_type text not null default 'in_app', -- 'in_app' | 'email' | 'whatsapp' (whatsapp lands in a later phase)
  status text not null default 'pending', -- 'pending' | 'sent' | 'dismissed'
  created_at timestamptz not null default now()
);

create index reminders_remind_at_idx on public.reminders(remind_at);
create index reminders_user_id_idx on public.reminders(user_id);

alter table public.reminders enable row level security;

create policy "Users manage their own reminders"
  on public.reminders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);