import { createBrowserClient } from '@supabase/ssr';

// Used in Client Components. Reads the public URL + anon key only —
// RLS is what actually keeps one user's data away from another's, not this file.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}