# Setup Guide

This gets the AI Executive Assistant foundation running locally end-to-end: real login, real database, real Row Level Security.

## 1. Prerequisites

- Node.js 20+ and npm
- A free [Supabase](https://supabase.com) account

## 2. Create your Supabase project

1. Go to supabase.com → **New project**.
2. Choose a name (e.g. `kbrisks-executive-ai`) and a strong database password (save it somewhere safe — you won't need it day-to-day, but you'll want it if you ever connect via the Supabase CLI or a direct Postgres client).
3. Wait for the project to finish provisioning (~2 minutes).

## 3. Get your API keys

In your Supabase project: **Project Settings → API**. You need three values:

| Value | Where to find it |
|---|---|
| Project URL | "Project URL" field |
| `anon` `public` key | "Project API keys" → `anon` `public` |
| `service_role` key | "Project API keys" → `service_role` (click reveal) |

## 4. Configure environment variables

```bash
cp .env.example .env.local
```

Paste the three values from Step 3 into `.env.local`. See `environment-variables.md` for what each one is used for and why the service role key needs extra care.

## 5. Run the database migrations

In the Supabase dashboard: **SQL Editor → New query**. Open each file in `supabase/migrations/` **in order** (`0001` through `0005`) and run its contents. Each file is self-contained and creates its own tables, indexes, and Row Level Security policies.

(Once this project is further along, we'll switch to the Supabase CLI for migrations — `supabase db push` — but running them by hand in order is the simplest path for now.)

## 6. Install dependencies and run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`. You should be redirected to `/login`.

## 7. Verify it actually works

1. Go to `/register`, create an account with a real email.
2. Supabase sends a confirmation email by default — check your inbox and confirm, or disable email confirmation in **Authentication → Providers → Email** for local testing.
3. Sign in at `/login`. You should land on the Dashboard with your email shown in the top-right and the sidebar visible.
4. In the Supabase dashboard, check **Table Editor → profiles** — a row should already exist for your new user (created automatically by the `handle_new_user` trigger).
5. Open an incognito window, register a *second* account, and confirm you cannot see the first account's data anywhere (there isn't much to see yet, but this is the RLS pattern every future table follows).