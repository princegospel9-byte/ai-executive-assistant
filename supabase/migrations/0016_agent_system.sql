-- Phase 7: AI Agent Team System. Agents are not separate running processes -
-- each is a named identity (system prompt + capabilities + permissions)
-- invoked through the same AI - Process Request sub-workflow every phase
-- since Phase 2 has used. Reuse decisions, same reasoning as every prior
-- phase - see documentation/agent-system-module.md:
--   - no separate agent_activity_logs table: activity_logs (Phase 4) gets
--     an agent_id column instead.
--   - no daily agent briefing workflow: folds into daily_briefing (v3).
--   - finance_entries and support_tickets ARE genuinely new - nothing in
--     Phases 1-6 tracks money or support requests at all.

-- ── agents: seeded roster, not user-editable from the browser ───────────
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null unique, -- 'sales' | 'marketing' | 'finance' | 'support' | 'research' | 'operations'
  name text not null,
  role text not null,
  description text not null,
  capabilities text[] not null default '{}',
  status text not null default 'active', -- 'active' | 'disabled'
  created_at timestamptz not null default now()
);

alter table public.agents enable row level security;

create policy "Authenticated users can read agents"
  on public.agents for select
  using (auth.role() = 'authenticated');

-- ── agent_tasks: what the router decided each agent should do ───────────
create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  parent_request text not null,
  subtask text not null,
  priority text not null default 'medium', -- 'low' | 'medium' | 'high'
  status text not null default 'pending', -- 'pending' | 'in_progress' | 'completed' | 'failed'
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index agent_tasks_user_id_created_at_idx on public.agent_tasks(user_id, created_at desc);
create index agent_tasks_agent_id_idx on public.agent_tasks(agent_id);

alter table public.agent_tasks enable row level security;

create policy "Users view their own agent tasks"
  on public.agent_tasks for select
  using (auth.uid() = user_id);

-- ── agent_outputs: what each agent produced for a task ───────────────────
create table public.agent_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_task_id uuid not null references public.agent_tasks(id) on delete cascade,
  output_text text not null,
  output_json jsonb,
  requires_approval boolean not null default false,
  approval_id uuid references public.approvals(id) on delete set null,
  status text not null default 'info', -- 'info' | 'pending_approval' | 'approved' | 'rejected'
  created_at timestamptz not null default now()
);

create index agent_outputs_agent_task_id_idx on public.agent_outputs(agent_task_id);
create index agent_outputs_status_idx on public.agent_outputs(status);

alter table public.agent_outputs enable row level security;

-- select-only - all status transitions happen via the approval-decision
-- webhooks (service role), same reasoning as generated_messages/ai_insights.
create policy "Users view their own agent outputs"
  on public.agent_outputs for select
  using (auth.uid() = user_id);

-- ── agent_memory: per-agent learned preference, distinct from the shared
-- business_memory (Phase 6) - mirrors its category/key/value shape ───────
create table public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  category text not null,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, agent_id, category, key)
);

alter table public.agent_memory enable row level security;

create policy "Users view their own agent memory"
  on public.agent_memory for select
  using (auth.uid() = user_id);

create policy "Users edit their own agent memory"
  on public.agent_memory for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── agent_permissions: which action types an agent may propose need
-- approval before executing - seeded config, not user-editable yet ──────
create table public.agent_permissions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  action_type text not null,
  requires_approval boolean not null default true,
  unique (agent_id, action_type)
);

alter table public.agent_permissions enable row level security;

create policy "Authenticated users can read agent permissions"
  on public.agent_permissions for select
  using (auth.role() = 'authenticated');

-- ── activity_logs: add agent attribution instead of a parallel table ────
alter table public.activity_logs
  add column agent_id uuid references public.agents(id) on delete set null;

create index activity_logs_agent_id_idx on public.activity_logs(agent_id);

-- ── finance_entries: genuinely new, manual entry (no accounting/bank
-- integration in scope) ───────────────────────────────────────────────────
create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_type text not null, -- 'income' | 'expense'
  category text not null,
  amount numeric(12,2) not null,
  currency text not null default 'GHS',
  description text,
  occurred_on date not null,
  created_at timestamptz not null default now()
);

create index finance_entries_user_id_occurred_on_idx on public.finance_entries(user_id, occurred_on desc);

alter table public.finance_entries enable row level security;

create policy "Users manage their own finance entries"
  on public.finance_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── support_tickets: genuinely new ───────────────────────────────────────
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  contact_email text,
  subject text not null,
  description text not null,
  status text not null default 'open', -- 'open' | 'awaiting_approval' | 'resolved' | 'closed'
  priority text not null default 'medium',
  draft_response text,
  approval_id uuid references public.approvals(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index support_tickets_user_id_status_idx on public.support_tickets(user_id, status);
create index support_tickets_school_id_idx on public.support_tickets(school_id);

alter table public.support_tickets enable row level security;

create policy "Users manage their own support tickets"
  on public.support_tickets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── seed the agent roster ─────────────────────────────────────────────────
insert into public.agents (agent_key, name, role, description, capabilities) values
('sales', 'Sales Agent', 'AI Sales Manager', 'Grows SchoolPro GH''s customer base - lead quality, follow-up strategy, objection handling, demo strategy.', array['lead_generation', 'follow_up_strategy', 'objection_analysis', 'crm_recommendations']),
('marketing', 'Marketing Agent', 'AI Marketing Manager', 'Drafts promotional content for KBrisks products. Never publishes anything itself - every piece of content needs your approval.', array['content_drafting', 'campaign_ideas', 'brand_voice']),
('finance', 'Finance Agent', 'AI Finance Manager', 'Tracks income, expenses, and subscriptions you log manually, and surfaces profitability insights and monthly reports.', array['expense_tracking', 'financial_reporting', 'cost_insights']),
('support', 'Customer Support Agent', 'AI Support Manager', 'Drafts replies to support tickets using your product documentation and customer history. Never sends anything without approval.', array['ticket_drafting', 'knowledge_lookup']),
('research', 'Research Agent', 'AI Business Intelligence Analyst', 'Researches competitors, market trends, and opportunities using web search.', array['competitor_research', 'market_trends', 'opportunity_analysis']),
('operations', 'Operations Agent', 'AI Operations Manager', 'Analyzes your own workflows, tasks, and automation runs for bottlenecks and automation opportunities.', array['process_analysis', 'automation_suggestions']);

-- ── seed permissions: which action types need approval per agent ────────
insert into public.agent_permissions (agent_id, action_type, requires_approval)
select id, action_type, true
from public.agents, unnest(
  case agent_key
    when 'sales' then array['send_message']
    when 'marketing' then array['publish_content']
    when 'support' then array['send_support_reply']
    else array[]::text[]
  end
) as action_type;