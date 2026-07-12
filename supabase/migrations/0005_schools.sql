-- SchoolPro GH sales pipeline. Deliberately standalone (not FK'd into
-- contacts/organizations yet) to match exactly what Phase 1 asked for —
-- contact_person/phone/email are stored inline here. Wiring schools to the
-- shared contacts/organizations tables is a Phase 5 decision, not a Phase 1 one.
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_name text not null,
  location text,
  student_population integer,
  contact_person text,
  phone text,
  email text,
  current_software_system text,
  interest_level text not null default 'cold', -- 'cold' | 'warm' | 'hot'
  status text not null default 'not_contacted', -- 'not_contacted' | 'contacted' | 'demo_scheduled' | 'demo_done' | 'proposal_sent' | 'won' | 'lost'
  next_follow_up_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index schools_status_idx on public.schools(status);
create index schools_next_follow_up_date_idx on public.schools(next_follow_up_date);
create index schools_user_id_idx on public.schools(user_id);

alter table public.schools enable row level security;

create policy "Users manage their own schools"
  on public.schools for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.school_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  interaction_type text not null, -- 'call' | 'visit' | 'email' | 'demo' | 'proposal' | 'note'
  notes text,
  occurred_at timestamptz not null default now(),
  next_action text,
  created_at timestamptz not null default now()
);

create index school_interactions_school_id_idx on public.school_interactions(school_id);

alter table public.school_interactions enable row level security;

create policy "Users manage their own school interactions"
  on public.school_interactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);