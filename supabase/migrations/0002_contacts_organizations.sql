-- Organizations: companies, schools, churches, agencies — anything a contact belongs to.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text, -- 'company' | 'school' | 'church' | 'agency' | other free text
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

create policy "Users manage their own organizations"
  on public.organizations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Contacts: the single source of truth for every person across every module
-- (CRM, School Sales, personal). Other modules reference this table by FK
-- rather than storing their own copy of a person's name/email/phone.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  category text, -- 'client' | 'lead' | 'personal' | 'church' | 'recruiter' | other free text
  notes text,
  relationship_score numeric(3,1), -- 0.0-10.0, populated by the CRM Agent in a later phase
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_organization_id_idx on public.contacts(organization_id);
create index contacts_user_id_idx on public.contacts(user_id);

alter table public.contacts enable row level security;

create policy "Users manage their own contacts"
  on public.contacts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);