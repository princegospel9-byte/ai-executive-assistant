# Development Guide

## Folder structure

```
app/
  (dashboard)/        Route group — every page here shares the sidebar layout
    layout.tsx         Sidebar + header shell, fetches the signed-in user
    page.tsx            Dashboard Home
    email/, calendar/, tasks/, contacts/, crm/, school-sales/,
    job-tracker/, assistant/, settings/   Placeholder pages, one per module
    actions.ts          Server Actions shared across dashboard pages (currently: signOut)
  login/, register/     Public auth pages, each with its own actions.ts
  layout.tsx             Root layout (fonts, metadata)
  globals.css             Tailwind v4 entry point + theme tokens

components/
  layout/                 Sidebar, page placeholder, sign-out button — app-specific
  ui/                      shadcn/ui primitives (button, input, label, card, separator) — treat as vendored, don't hand-edit unless you mean to fork the component

lib/
  supabase/
    client.ts               Browser Supabase client (Client Components)
    server.ts                Server Supabase client (Server Components / Actions) — still RLS-scoped
    service.ts                 Service-role client — bypasses RLS, server-only, use sparingly
    middleware.ts                Session refresh + route protection logic, called from root middleware.ts

middleware.ts             Runs on every request; redirects signed-out users to /login and signed-in users away from /login /register

supabase/migrations/      Plain SQL files, applied in order. See database-schema.md.

documentation/            You are here.
```

## Adding a new page

1. Create `app/(dashboard)/<name>/page.tsx` inside the route group so it inherits the sidebar.
2. Add the nav entry in `components/layout/sidebar.tsx`'s `NAV_ITEMS` array.
3. Start with `<PagePlaceholder />` if the feature isn't built yet — keeps the nav honest about what's real.

## Adding a new database table

1. Create `supabase/migrations/000N_description.sql` — next sequential number.
2. Follow the existing pattern: `id`, `user_id` FK to `auth.users`, `created_at`/`updated_at`, `enable row level security`, and a policy scoped to `auth.uid() = user_id`.
3. Run it in the Supabase SQL Editor (or via CLI once that's wired up).
4. Document it in `documentation/database-schema.md`.

## Adding a new shadcn/ui component

```bash
npx shadcn@latest add <component-name>
```

This copies the component's source into `components/ui/` — it becomes part of your codebase, not a black-box dependency. Customize freely.

## Server Component vs Client Component — which Supabase client to use

- **Server Component / Server Action / Route Handler:** `import { createClient } from '@/lib/supabase/server'` — reads the session from cookies, still RLS-scoped.
- **Client Component** (anything with `'use client'` that needs live/interactive Supabase calls, e.g. Realtime subscriptions): `import { createClient } from '@/lib/supabase/client'`.
- **Never** import `lib/supabase/service.ts` into anything that could run in the browser. If TypeScript/ESLint ever flags this, treat it as a bug to fix immediately, not a warning to suppress.

## Running locally

```bash
npm run dev      # dev server, http://localhost:3000
npm run build    # production build — run this before considering a phase "done"
npm run lint      # ESLint
```