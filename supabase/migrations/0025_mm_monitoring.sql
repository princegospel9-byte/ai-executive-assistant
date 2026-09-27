-- Phase 10: MoneyManager Monitoring (offline). MoneyManager
-- (moneymanager.kbrisks.com) is a separate, already-production financial
-- system - this phase does NOT connect to it live. It reads a periodically
-- exported read-only sqlite snapshot (lib/moneymanager/client/snapshot.ts)
-- and runs a deterministic rule engine (lib/moneymanager/rules/) over it -
-- no LLM calls inside the rule engine itself, same "app layer stays thin,
-- decisions stay inspectable" discipline as lib/business/health-score.ts.
-- See documentation/moneymanager-monitoring.md for the full design.
--
-- Deliberately NOT touched: finance_entries and business_metrics (Phase 7/9)
-- stay exactly what they've always meant - Prince's own manually-logged
-- income/expenses and KBrisks' own SaaS business metrics. MoneyManager data
-- is a different business (a susu/savings company) and never gets written
-- into either table.

-- ── mm_sync_checkpoints: which snapshot was last processed, and a cheap
-- fingerprint (row counts) to tell whether it changed since the last run ──
create table public.mm_sync_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_identifier text not null, -- file path + size + mtime, see run.ts
  table_counts jsonb not null default '{}',
  last_run_id uuid,
  checked_at timestamptz not null default now(),
  unique (user_id, snapshot_identifier)
);

alter table public.mm_sync_checkpoints enable row level security;

create policy "Users manage their own mm sync checkpoints"
  on public.mm_sync_checkpoints for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── mm_monitoring_runs: one row per monitoring execution ────────────────
create table public.mm_monitoring_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'running', -- 'running' | 'completed' | 'incomplete' | 'failed'
  business_date date not null,
  snapshot_identifier text not null,
  snapshot_file_size_bytes bigint not null default 0,
  snapshot_file_modified_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  incomplete_reason text,
  error_message text,
  finding_counts jsonb not null default '{}' -- {"CRITICAL": 2, "HIGH": 5, ...}
);

create index mm_monitoring_runs_user_id_started_at_idx on public.mm_monitoring_runs(user_id, started_at desc);

alter table public.mm_monitoring_runs enable row level security;

create policy "Users manage their own mm monitoring runs"
  on public.mm_monitoring_runs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── mm_findings: deterministic rule output, deduplicated by dedupe_key ───
-- dedupe_key = sha256(ruleId|entityType|entityId|businessDate|findingType) -
-- see lib/moneymanager/dedupe.ts. Re-running against an unchanged snapshot
-- upserts the same row instead of inserting a duplicate.
create table public.mm_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null unique,
  rule_id text not null,
  finding_type text not null,
  severity text not null, -- 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL'
  entity_type text not null,
  entity_id text not null,
  expected_value numeric,
  actual_value numeric,
  variance numeric,
  business_date text not null, -- kept as text: some source dates are malformed (see mm.data_integrity.v1) and 'unknown' is a valid value
  evidence jsonb not null default '{}',
  first_seen_run_id uuid references public.mm_monitoring_runs(id) on delete set null,
  last_seen_run_id uuid references public.mm_monitoring_runs(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index mm_findings_user_id_severity_idx on public.mm_findings(user_id, severity);
create index mm_findings_user_id_business_date_idx on public.mm_findings(user_id, business_date);
create index mm_findings_rule_id_idx on public.mm_findings(rule_id);

alter table public.mm_findings enable row level security;

create policy "Users view their own mm findings"
  on public.mm_findings for select
  using (auth.uid() = user_id);

-- ── mm_alerts: HIGH/CRITICAL findings surfaced for attention ────────────
create table public.mm_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  finding_dedupe_key text not null references public.mm_findings(dedupe_key) on delete cascade,
  severity text not null,
  title text not null,
  status text not null default 'open', -- 'open' | 'acknowledged' | 'dismissed'
  created_at timestamptz not null default now(),
  unique (finding_dedupe_key)
);

create index mm_alerts_user_id_status_idx on public.mm_alerts(user_id, status);

alter table public.mm_alerts enable row level security;

create policy "Users manage their own mm alerts"
  on public.mm_alerts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── mm_agent_analysis: AI commentary on a batch of findings, written by
-- the specialist agents (agent_transaction_integrity, agent_reconciliation,
-- agent_business_performance - see 0026_mm_monitoring_prompts.sql) via the
-- existing Agent - Orchestrate Request n8n workflow. The AI only ever sees
-- rows already in mm_findings (Finding[] shape) - never the sqlite
-- snapshot, MoneyManager credentials, or raw ledger rows. ─────────────────
create table public.mm_agent_analysis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  monitoring_run_id uuid references public.mm_monitoring_runs(id) on delete cascade,
  summary text not null,
  recommendations text[] not null default '{}',
  finding_dedupe_keys text[] not null default '{}', -- which mm_findings rows this analysis is about
  created_at timestamptz not null default now()
);

create index mm_agent_analysis_user_id_created_at_idx on public.mm_agent_analysis(user_id, created_at desc);
create index mm_agent_analysis_monitoring_run_id_idx on public.mm_agent_analysis(monitoring_run_id);

alter table public.mm_agent_analysis enable row level security;

create policy "Users view their own mm agent analysis"
  on public.mm_agent_analysis for select
  using (auth.uid() = user_id);

-- ── seed the three new specialist agents onto the existing roster ───────
-- (Mobilizer/Collector activity monitoring and Daily Reconciliation are
-- deliberately NOT covered by any agent yet - MoneyManager currently has no
-- way to grant read-only access to that data without also granting write/
-- manage permissions. See documentation/moneymanager-monitoring.md.)
insert into public.agents (agent_key, name, role, description, capabilities) values
('transaction_integrity', 'Transaction Integrity Agent', 'AI Transaction Integrity Analyst', 'Reviews MoneyManager transaction-level findings (duplicates, orphaned records, balance mismatches) surfaced by the offline monitoring engine and explains what needs human attention first.', array['duplicate_review', 'balance_mismatch_review', 'orphaned_record_review']),
('reconciliation', 'Reconciliation Agent', 'AI Reconciliation Analyst', 'Reviews MoneyManager Vault and general-ledger reconciliation findings and explains likely causes and priority, grounded only in the findings given.', array['vault_reconciliation_review', 'gl_reconciliation_review', 'daily_totals_review']),
('business_performance', 'Business Performance Agent', 'AI Business Performance Analyst', 'Summarizes MoneyManager monitoring runs at a portfolio level - trends across findings over time, which branches/products need attention.', array['monitoring_trend_analysis', 'portfolio_summary']);
