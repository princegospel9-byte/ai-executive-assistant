-- "Compare with Office Records" configuration: the six Google Sheets URLs
-- (five zone cash-received-in-hand sheets + one master workbook) MoneyManager
-- itself asks staff to fill in under Settings -> Office Records Sheets (see
-- moneymanager-standalone-src/src/database/migrations/0106_create_office_
-- records_settings.sql for the source-of-truth desktop schema this mirrors).
-- Same "user fills this in via the app" convention already established by
-- voice_preferences (0018_voice_multimodal.sql) - a singleton-per-user row,
-- not an env var, since these are values Prince edits at runtime, not
-- deploy-time secrets. No URL is seeded here - the row starts empty and the
-- lib/moneymanager/rules/officeRecordsComparison.ts rule reports "not
-- configured" until a human fills it in. See documentation/moneymanager-
-- monitoring.md.
create table public.mm_office_records_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  zone_a_url text,
  zone_b_url text,
  zone_c_url text,
  zone_d_url text,
  zone_e_url text,
  master_workbook_url text,
  updated_at timestamptz not null default now()
);

alter table public.mm_office_records_config enable row level security;

create policy "Users manage their own mm office records config"
  on public.mm_office_records_config for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
