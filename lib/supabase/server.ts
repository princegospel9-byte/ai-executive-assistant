import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Used in Server Components, Server Actions, and Route Handlers. Still uses
// the anon key + the signed-in user's session cookie — RLS still applies.
// This is NOT the service-role client; see lib/supabase/service.ts for that.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component that can't set cookies directly —
            // safe to ignore because middleware.ts refreshes the session on every request.
          }
        },
      },
    }
  );
}