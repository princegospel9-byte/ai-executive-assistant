-- Phase 4A: deterministic finding classification. Adds two columns to the
-- existing mm_findings table (no new table - classification is an
-- attribute of a finding, not a separate entity) written by
-- lib/moneymanager/classification/classify.ts, which runs BEFORE any AI
-- step ever sees a finding - see documentation/moneymanager-monitoring.md's
-- "Finding classification" section. The AI never assigns or overrides
-- classification; it only annotates one that's already here.
alter table public.mm_findings
  add column if not exists classification text, -- one of the 9 closed values, or NULL only for the office-records summary rollup - see lib/moneymanager/classification/types.ts
  add column if not exists classification_reason text;

create index if not exists mm_findings_user_id_classification_idx on public.mm_findings(user_id, classification);
