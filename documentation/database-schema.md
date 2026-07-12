# Database Schema (Phase 1)

Every table follows the same pattern unless noted otherwise:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid references auth.users(id)` — ownership column
- Row Level Security enabled, policy = `user_id = auth.uid()` — **you can only ever see or modify your own rows**, enforced by Postgres itself, not by application code
- `created_at` / `updated_at timestamptz`

This `user_id`-per-row pattern is deliberate: it's already the seed of multi-tenancy. If this platform ever supports other customers, each customer's data is already isolated the same way — no schema rework needed, just more users.

## `profiles`

One row per signed-up user, created automatically by a database trigger the moment someone registers (see `0001_profiles.sql`). Holds `full_name`, `role`, `phone_number`, `company_name`, `timezone`, and a `preferences` jsonb column for anything else that doesn't need its own column yet.

*Not FK'd to anything — it's the root.*

## `organizations`

Companies, schools, churches, agencies — anything a `contact` can belong to. Fields: `name`, `type`, `location`, `notes`.

## `contacts`

**The single source of truth for people.** Every other module (CRM, School Sales, future WhatsApp) references a person via this table rather than storing its own copy of their name/email/phone — this is what prevents the same person existing three different ways across the app. Fields: `full_name`, `email`, `phone`, `category`, `notes`, `relationship_score` (populated by an AI agent in a later phase), `last_contacted_at`. FK → `organizations`.

## `communication_timeline`

Every interaction with a contact, any channel, one chronological log: `interaction_type` (email/call/meeting/visit/note/whatsapp), `summary`, `occurred_at`. FK → `contacts`. Future phases (Email Agent, WhatsApp) write here automatically — a contact's full history is always in one place regardless of which module logged it.

## `tasks`

To-dos from any source: `title`, `description`, `priority`, `status`, `due_date`, optional FK → `contacts`.

## `reminders`

Scheduled nudges. Currently targets a `task_id` specifically (not polymorphic yet) — when a second target type is needed (e.g. calendar events), that's the point to generalize it, not before.

## `schools`

SchoolPro GH's sales pipeline, standalone for Phase 1 (not yet wired to `contacts`/`organizations` — that integration is a Phase 5 decision). Fields: `school_name`, `location`, `student_population`, `contact_person`/`phone`/`email` (inline for now), `current_software_system`, `interest_level`, `status`, `next_follow_up_date`.

## `school_interactions`

Visit/call/demo/proposal log per school. FK → `schools`.

---

## Why RLS instead of checking `user_id` in application code

Every table has RLS enabled with a policy like:

```sql
create policy "Users manage their own contacts"
  on public.contacts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

This means even if a bug in the frontend code forgot to filter by `user_id`, Postgres itself refuses to return or modify another user's rows. The only way to bypass this is the `service_role` key — which never runs in the browser and is reserved for specific server-only operations (see `environment-variables.md`).