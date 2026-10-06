# Setup Guide

This gets the AI Executive Assistant foundation running locally end-to-end: real login, real database, real Row Level Security. **This covers Supabase + the Next.js app only.** Once this works, three more things are needed before the system is fully live — each has its own guide, linked at the bottom: an n8n instance running all 43 workflows, Google OAuth (Gmail + Calendar), and three more API keys (Anthropic, Voyage AI, ElevenLabs).

## 1. Prerequisites

- Node.js 22+ and npm (the MoneyManager monitoring module's CLI scripts, `scripts/mm-monitor.ts` and `scripts/mm-daily-report.ts`, use Node's built-in `node:sqlite`, which does not exist before Node 22 - see `package.json`'s `engines` field; tested on Node 24.x)
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

In the Supabase dashboard: **SQL Editor → New query**. Open each file in `supabase/migrations/` **in order** (`0001` through `0021`) and run its contents. Each file is self-contained and creates its own tables, indexes, and Row Level Security policies. This will take a while by hand at 21 files — running them one at a time, in numeric order, is what matters (several later files alter tables an earlier file created).

(The Supabase CLI's `supabase db push` would run all of these in one command if you ever install it — not required, just faster than pasting 21 files by hand.)

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

## 8. What's next — the rest of the system

Everything above gets the Next.js app itself running. None of the AI features work yet until these three things happen, roughly in this order:

1. **n8n** — every AI feature in this system (email, calendar, CRM, knowledge base, agents, voice, forecasting — 43 workflows total) runs through n8n, not the Next.js app directly. Follow `n8n-setup-guide.md`: get an instance running (free via `deploy/n8n/docker-compose.yml`, or paid via n8n Cloud), set the n8n Variables, import all 43 workflow files, re-link every Execute Workflow node, and activate the webhook/schedule ones. This is the single biggest remaining step — budget real time for it.
2. **Google OAuth** (Gmail + Calendar) — needed for the Email Assistant (Phase 3) and Calendar sync (Phase 4). Covered in `email-module.md` and `calendar-tasks-module.md`.
3. **Three more API keys**, each a free signup: **Anthropic** (console.anthropic.com — powers every AI call), **Voyage AI** (voyageai.com — powers document search in the Knowledge Base), **ElevenLabs** (elevenlabs.io — powers voice conversation; free tier is ~10 min/month, see `voice-multimodal-module.md` for the honest cost picture). Anthropic and Voyage are n8n Variables; ElevenLabs is a Next.js env var (`ELEVENLABS_API_KEY` in `.env.local`).

Once those three are done, deploying the Next.js app itself to Vercel is the last step: push this repo to GitHub, import it in Vercel, and set the same variables from `.env.local` (plus `N8N_WEBHOOK_BASE_URL`/`N8N_WEBHOOK_SECRET` pointing at wherever n8n ends up running) in the Vercel project's Environment Variables.