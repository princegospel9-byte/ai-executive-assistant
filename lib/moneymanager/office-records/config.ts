// Configuration for the "Compare with Office Records" source: six
// staff-filled Google Sheets URLs (five zone cash-received sheets + one
// master workbook), read from this repo's existing Supabase project -
// following the SAME "user fills this in via the app" pattern already
// established by voice_preferences (supabase/migrations/0018_voice_
// multimodal.sql): a singleton-per-user row, RLS-protected, not an env var
// (env vars aren't this repo's convention for user-editable settings; see
// documentation/moneymanager-monitoring.md for the comparison that led to
// this choice). Table: mm_office_records_config
// (supabase/migrations/0027_mm_office_records_config.sql).
//
// This module deliberately does NOT hardcode or fabricate any URL. The six
// real URLs have not been provided as of this phase - see the "not
// configured" path below, which is the expected, correct state until a
// human fills them in.
import type { SupabaseClient } from '@supabase/supabase-js';

export type OfficeRecordsUrls = {
  zoneA: string;
  zoneB: string;
  zoneC: string;
  zoneD: string;
  zoneE: string;
  masterWorkbook: string;
};

export type OfficeRecordsConfigResult =
  | { configured: true; urls: OfficeRecordsUrls }
  | { configured: false; missing: string[] };

const REQUIRED_FIELDS: { column: string; label: string; key: keyof OfficeRecordsUrls }[] = [
  { column: 'zone_a_url', label: 'Zone A', key: 'zoneA' },
  { column: 'zone_b_url', label: 'Zone B', key: 'zoneB' },
  { column: 'zone_c_url', label: 'Zone C', key: 'zoneC' },
  { column: 'zone_d_url', label: 'Zone D', key: 'zoneD' },
  { column: 'zone_e_url', label: 'Zone E', key: 'zoneE' },
  { column: 'master_workbook_url', label: 'Master Workbook', key: 'masterWorkbook' },
];

/** The "not configured" result - used as the default whenever a caller
 * (a test, or a script that hasn't wired up Supabase) doesn't supply a
 * real config, so the office-records rule always has an explicit,
 * correct-by-default input rather than silently being skipped. */
export const OFFICE_RECORDS_NOT_CONFIGURED: OfficeRecordsConfigResult = {
  configured: false,
  missing: REQUIRED_FIELDS.map((f) => f.label),
};

/** Loads mm_office_records_config for a user from Supabase. Never throws on
 * "no row yet" or "row exists but empty" - both resolve to `configured:
 * false` with the specific missing fields named, matching this rule's
 * fail-safe convention (missing config is reported explicitly, not treated
 * as silently fine). Only throws on an actual Supabase error (network/
 * auth/schema problem), which the caller should treat like any other
 * infra failure. */
export async function loadOfficeRecordsConfig(
  client: SupabaseClient,
  userId: string
): Promise<OfficeRecordsConfigResult> {
  const { data, error } = await client
    .from('mm_office_records_config')
    .select('zone_a_url, zone_b_url, zone_c_url, zone_d_url, zone_e_url, master_workbook_url')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load mm_office_records_config: ${error.message}`);
  }

  if (!data) {
    return OFFICE_RECORDS_NOT_CONFIGURED;
  }

  const row = data as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter((f) => !row[f.column]).map((f) => f.label);
  if (missing.length > 0) {
    return { configured: false, missing };
  }

  return {
    configured: true,
    urls: {
      zoneA: row.zone_a_url as string,
      zoneB: row.zone_b_url as string,
      zoneC: row.zone_c_url as string,
      zoneD: row.zone_d_url as string,
      zoneE: row.zone_e_url as string,
      masterWorkbook: row.master_workbook_url as string,
    },
  };
}
