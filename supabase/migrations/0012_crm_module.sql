-- Phase 5: extends schools/school_interactions (built in Phase 1, deliberately
-- left unwired from contacts/organizations until now) and tasks (Phase 4),
-- adds generated_messages. No new "leads"/"interactions" tables - see
-- documentation/crm-module.md for why the existing tables cover this.

-- ── unique constraints needed for the Import workflow's upsert-by-name/email
-- pattern (on_conflict requires a real constraint - none of these three
-- existed before, since nothing needed idempotent upsert-by-name until now) ─
alter table public.organizations add constraint organizations_user_name_unique unique (user_id, name);
alter table public.contacts add constraint contacts_user_email_unique unique (user_id, email);
alter table public.schools add constraint schools_user_school_name_unique unique (user_id, school_name);

-- ── schools: link into the shared contact model, add fields, realign stages ─
alter table public.schools
  add column lead_source text,
  add column first_contacted_at timestamptz,
  add column organization_id uuid references public.organizations(id) on delete set null,
  add column contact_id uuid references public.contacts(id) on delete set null;

-- Realign the 7-stage vocabulary from Phase 1 to the 8-stage one this phase
-- specifies. Harmless no-op if the table is still empty.
update public.schools set status = 'new_lead' where status = 'not_contacted';
update public.schools set status = 'demo_completed' where status = 'demo_done';
update public.schools set status = 'negotiating' where status = 'proposal_sent';
update public.schools set status = 'customer' where status = 'won';
update public.schools set status = 'lost_lead' where status = 'lost';

comment on column public.schools.status is 'new_lead | contacted | demo_scheduled | demo_completed | negotiating | trial_started | customer | lost_lead';

create index schools_organization_id_idx on public.schools(organization_id);
create index schools_contact_id_idx on public.schools(contact_id);

-- ── school_interactions: capture objections for the follow-up assistant ────
alter table public.school_interactions
  add column objections text;

-- ── tasks: reverse-link to the school a follow-up task came from ───────────
alter table public.tasks
  add column related_school_id uuid references public.schools(id) on delete set null;

create index tasks_related_school_id_idx on public.tasks(related_school_id);

-- ── generated_messages ───────────────────────────────────────────────────
create table public.generated_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  message_type text not null, -- 'introduction' | 'demo_invitation' | 'follow_up' | 'pricing' | 'trial_activation' | 'support_reply'
  channel text not null, -- 'email' | 'whatsapp'
  subject text, -- email only
  content text not null,
  status text not null default 'draft', -- 'draft' | 'approved' | 'sent' | 'discarded'
  approval_id uuid references public.approvals(id) on delete set null, -- set for email sends only
  model_used text,
  prompt_version integer,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index generated_messages_school_id_idx on public.generated_messages(school_id);
create index generated_messages_status_idx on public.generated_messages(status);

alter table public.generated_messages enable row level security;

-- select + update only (editing before send), same reasoning as draft_replies
-- in Phase 3 - sending is routed through the approval webhook, not a direct
-- status write from the browser.
create policy "Users view their own generated messages"
  on public.generated_messages for select
  using (auth.uid() = user_id);

create policy "Users edit their own generated messages"
  on public.generated_messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);