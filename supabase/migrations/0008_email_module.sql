create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_address text not null,
  display_name text,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, email_address)
);

alter table public.email_accounts enable row level security;

-- select + update only, deliberately - accounts are created by the polling
-- workflow (service role); the browser can view/toggle one but not insert
-- or delete.
create policy "Users view their own email accounts"
  on public.email_accounts for select
  using (auth.uid() = user_id);

create policy "Users update their own email accounts"
  on public.email_accounts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_account_id uuid not null references public.email_accounts(id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text not null,
  rfc_message_id text, -- the RFC 2822 Message-ID header, needed later for In-Reply-To/References when sending a reply
  from_address text not null,
  from_name text,
  to_addresses text[] not null default '{}',
  subject text,
  body_text text,
  body_html text,
  snippet text,
  received_at timestamptz not null,
  is_read boolean not null default false,
  has_attachments boolean not null default false,
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (email_account_id, gmail_message_id)
);

create index emails_user_id_received_at_idx on public.emails(user_id, received_at desc);
create index emails_thread_id_idx on public.emails(gmail_thread_id);
create index emails_from_address_idx on public.emails(from_address);

alter table public.emails enable row level security;

-- select + update only (e.g. toggling is_read from the dashboard). No
-- insert (only the polling workflow, via service role, creates rows) and
-- deliberately no delete policy at all - "never delete emails" is enforced
-- here, not just by workflow convention.
create policy "Users view their own emails"
  on public.emails for select
  using (auth.uid() = user_id);

create policy "Users update their own emails"
  on public.emails for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 1:1 with emails - kept separate from the raw email so re-analysis never
-- touches the ingested data, and so this table can hold history if a future
-- phase wants versioned re-analysis instead of overwrite.
create table public.email_analysis (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null unique references public.emails(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text,
  category text, -- free text by design, not an enum - e.g. 'SchoolPro GH Lead', 'Existing Client',
                  -- 'Recruiter', 'Job Application', 'Supplier', 'Church', 'Finance', 'Personal',
                  -- 'Newsletter', 'Spam', 'Other' - the prompt suggests these, nothing enforces them,
                  -- so adding a new category later needs a prompt edit, not a migration
  priority text not null default 'medium', -- 'critical' | 'high' | 'medium' | 'low'
  priority_reason text,
  sentiment text, -- 'positive' | 'neutral' | 'negative'
  action_required boolean not null default false,
  suggested_deadline date,
  suggested_next_step text,
  labels text[] not null default '{}', -- e.g. 'Needs Reply', 'Waiting for Response', 'Follow Up', 'Meeting', 'Interview', 'Invoice', 'School Demo', 'Opportunity'
  model_used text,
  prompt_version integer,
  analyzed_at timestamptz not null default now()
);

create index email_analysis_priority_idx on public.email_analysis(priority);
create index email_analysis_category_idx on public.email_analysis(category);
create index email_analysis_action_required_idx on public.email_analysis(action_required);

alter table public.email_analysis enable row level security;

create policy "Users view their own email analysis"
  on public.email_analysis for select
  using (auth.uid() = user_id);

create table public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.emails(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  gmail_attachment_id text not null,
  ai_summary text, -- populated once attachment summarization is built - null until then
  created_at timestamptz not null default now()
);

create index email_attachments_email_id_idx on public.email_attachments(email_id);

alter table public.email_attachments enable row level security;

create policy "Users view their own email attachments"
  on public.email_attachments for select
  using (auth.uid() = user_id);

create table public.draft_replies (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.emails(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  approval_id uuid references public.approvals(id) on delete set null,
  tone text not null default 'professional', -- 'professional' | 'friendly' | 'formal' | 'short' | 'detailed'
  draft_text text not null,
  edited_text text, -- set when the user edits before approving; sending prefers this over draft_text
  status text not null default 'pending', -- 'pending' | 'superseded' | 'approved' | 'rejected' | 'sent'
  model_used text,
  prompt_version integer,
  generated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index draft_replies_email_id_idx on public.draft_replies(email_id);
create index draft_replies_status_idx on public.draft_replies(status);

alter table public.draft_replies enable row level security;

-- select + update only. Update covers editing draft text before approval;
-- approving/rejecting/sending is deliberately routed through the n8n
-- webhook workflow instead of a direct status update from the browser, so
-- "sent" can never happen without the send actually occurring.
create policy "Users view their own draft replies"
  on public.draft_replies for select
  using (auth.uid() = user_id);

create policy "Users edit their own draft replies"
  on public.draft_replies for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);