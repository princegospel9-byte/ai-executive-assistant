import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// DANGER: bypasses Row Level Security entirely. Only import this from
// server-only code (API routes, later n8n/agent integrations) that has a
// deliberate, specific reason to read/write across all users' data.
// Never import this file from a Client Component or anything that runs in
// the browser — SUPABASE_SERVICE_ROLE_KEY is not prefixed with NEXT_PUBLIC_
// for exactly this reason, so doing so will fail at build/runtime anyway.
export function createServiceClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}