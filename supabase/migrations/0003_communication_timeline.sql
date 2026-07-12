-- Every interaction with a contact, any channel, in one chronological log.
-- Future phases (Email Agent, WhatsApp) write here too, so a contact's full
-- history is always visible in one place regardless of which module logged it.
create table public.communication_timeline (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  interaction_type text not null, -- 'email' | 'call' | 'meeting' | 'visit' | 'note' | 'whatsapp'
  summary text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index communication_timeline_contact_id_idx on public.communication_timeline(contact_id);
create index communication_timeline_occurred_at_idx on public.communication_timeline(occurred_at desc);

alter table public.communication_timeline enable row level security;

create policy "Users manage their own communication timeline"
  on public.communication_timeline for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);