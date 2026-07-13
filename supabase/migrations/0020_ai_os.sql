-- Phase 9: AI Autonomous Business Operating System. This is a consolidation
-- layer over Phases 1-8 more than a rebuild - see
-- documentation/ai-os-module.md for the full reasoning. Four deliberate
-- deviations from the spec's literal table list, same discipline as every
-- prior phase:
--   - no risk_alerts table: extends ai_insights (Phase 6/7, already
--     category-tagged 'risk'|'opportunity'|'recommendation') with
--     severity/mitigation_plan/resolved_at instead of forking it.
--   - no agent_coordination table: agent_tasks/agent_outputs (Phase 7)
--     already are this.
--   - no audit_logs table: activity_logs (Phase 4, agent_id-aware since
--     Phase 7) already is this.
--   - no approval_center table: approvals (Phase 3) already is this - the
--     fourth time this exact table has been asked for under a new name.
--   - the "knowledge graph" is a relational join table (entity_relationships)
--     over existing tables, not a dedicated graph database - Postgres
--     already does this fine at this scale.

-- ── ai_insights extension (absorbs risk_alerts) ──────────────────────────
alter table public.ai_insights
  add column severity text, -- 'low' | 'medium' | 'high' | 'critical'
  add column mitigation_plan text,
  add column resolved_at timestamptz;

-- ── business_metrics: periodic snapshot, feeds trend charts + forecasting ─
create table public.business_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric_date date not null,
  total_customers integer not null default 0,
  active_leads integer not null default 0,
  income_total numeric(12,2) not null default 0,
  expense_total numeric(12,2) not null default 0,
  tasks_completed integer not null default 0,
  tasks_pending integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, metric_date)
);

create index business_metrics_user_id_metric_date_idx on public.business_metrics(user_id, metric_date desc);

alter table public.business_metrics enable row level security;

create policy "Users view their own business metrics"
  on public.business_metrics for select
  using (auth.uid() = user_id);

-- ── company_goals / goal_progress ────────────────────────────────────────
create table public.company_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  goal_type text not null default 'custom', -- 'customer_count' | 'revenue' | 'custom'
  target_value numeric,
  target_date date,
  status text not null default 'active', -- 'active' | 'achieved' | 'abandoned'
  created_at timestamptz not null default now()
);

alter table public.company_goals enable row level security;

create policy "Users manage their own company goals"
  on public.company_goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.goal_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.company_goals(id) on delete cascade,
  current_value numeric,
  note text,
  recorded_at timestamptz not null default now()
);

create index goal_progress_goal_id_idx on public.goal_progress(goal_id);

alter table public.goal_progress enable row level security;

create policy "Users manage their own goal progress"
  on public.goal_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── business_predictions ─────────────────────────────────────────────────
-- Claude reasoning over business_metrics trends, NOT a statistical/ML
-- forecasting model - confidence and reasoning are the model's own stated
-- assessment, not a calculated margin of error. See documentation.
create table public.business_predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prediction_type text not null, -- 'revenue' | 'customer_growth' | 'churn_risk' | 'cash_flow'
  period_label text not null,
  predicted_value text not null,
  confidence text not null, -- 'low' | 'medium' | 'high'
  reasoning text not null,
  created_at timestamptz not null default now()
);

create index business_predictions_user_id_created_at_idx on public.business_predictions(user_id, created_at desc);

alter table public.business_predictions enable row level security;

create policy "Users view their own business predictions"
  on public.business_predictions for select
  using (auth.uid() = user_id);

-- ── executive_reports (quarterly/annual only - daily/weekly/monthly
-- already exist as daily_briefings/weekly_reviews/monthly_reports) ───────
create table public.executive_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_type text not null, -- 'quarterly' | 'annual'
  period_start date not null,
  period_end date not null,
  content_text text not null,
  content_json jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, report_type, period_start)
);

alter table public.executive_reports enable row level security;

create policy "Users view their own executive reports"
  on public.executive_reports for select
  using (auth.uid() = user_id);

-- ── system_learning ───────────────────────────────────────────────────────
create table public.system_learning (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  context_type text not null, -- 'agent_output' | 'sales_outcome' | 'approval_decision'
  context_summary text not null,
  outcome text not null, -- 'approved' | 'rejected' | 'won' | 'lost' | 'modified'
  related_record_type text,
  related_record_id uuid,
  created_at timestamptz not null default now()
);

create index system_learning_user_id_context_type_idx on public.system_learning(user_id, context_type);

alter table public.system_learning enable row level security;

create policy "Users view their own system learning"
  on public.system_learning for select
  using (auth.uid() = user_id);

-- ── entity_relationships (the "knowledge graph") ─────────────────────────
create table public.entity_relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_type text not null,
  from_id uuid not null,
  to_type text not null,
  to_id uuid not null,
  relationship_type text not null,
  created_at timestamptz not null default now(),
  unique (user_id, from_type, from_id, to_type, to_id, relationship_type)
);

create index entity_relationships_from_idx on public.entity_relationships(user_id, from_type, from_id);
create index entity_relationships_to_idx on public.entity_relationships(user_id, to_type, to_id);

alter table public.entity_relationships enable row level security;

create policy "Users view their own entity relationships"
  on public.entity_relationships for select
  using (auth.uid() = user_id);

-- ── expand the agent roster to the spec's 8 agents ───────────────────────
insert into public.agents (agent_key, name, role, description, capabilities) values
('knowledge', 'Knowledge Agent', 'AI Knowledge Manager', 'Answers questions using your documents, business memory, and how records connect to each other across the business.', array['document_search', 'relationship_reasoning']),
('reporting', 'Reporting Agent', 'AI Reporting Manager', 'Generates executive reports and business forecasts from your actual data - never estimates a figure it can''t ground in real records.', array['report_generation', 'forecasting']);