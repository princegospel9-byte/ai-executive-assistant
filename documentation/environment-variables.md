# Environment Variables

All variables live in `.env.local` (never committed — see `.gitignore`). `.env.example` documents the shape without real values.

| Variable | Exposed to browser? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Your Supabase project's API URL. Safe to expose — it's just an endpoint address. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | The public API key. Safe to expose *because* Row Level Security enforces access control at the database level — this key alone can't read or write anything a policy doesn't allow. |
| `SUPABASE_SERVICE_ROLE_KEY` | **No — never** | Bypasses Row Level Security entirely. Anyone holding this key can read or write *any* user's data. It has no `NEXT_PUBLIC_` prefix specifically so Next.js refuses to bundle it into client-side JavaScript. Only imported via `lib/supabase/service.ts`, and that file is only ever called from server-only code. |

## Rules for adding new environment variables later

- If a value is safe for anyone visiting the site to see (a public API URL, a feature flag), prefix it `NEXT_PUBLIC_`.
- If a value grants elevated access or costs money per call (API keys for Claude, Gmail, WhatsApp, etc.), **do not** prefix it `NEXT_PUBLIC_` — keep it server-only, and only reference it from server-only files (API routes, Server Actions, `lib/*` files that are never imported into a file marked `'use client'`).
- Always add the new variable to `.env.example` with an empty value, so the setup guide stays accurate for the next person (including future-you).