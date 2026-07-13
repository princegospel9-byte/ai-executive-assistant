# Calendar, Tasks & Reminders Module (Phase 4)

## Google Calendar OAuth setup

A **separate** n8n credential from Gmail, even though it can reuse the same Google Cloud project.

1. In the same Google Cloud project as Phase 3: **APIs & Services → Library** → enable **Google Calendar API**.
2. You can reuse the existing OAuth client from Phase 3, or create a new one — either way, add the same redirect URI (`https://<your-n8n-host>/rest/oauth2-credential/callback`) if it isn't already there.
3. In n8n: **Credentials → New → Google Calendar OAuth2 API** (a distinct credential type from Gmail OAuth2, even if backed by the same Client ID/Secret). Connect and authorize.

**Scope needed:** `https://www.googleapis.com/auth/calendar` (read/write — this module both reads your calendar and creates events, unlike the email module's read+send-only split).

## New n8n Variable

None beyond Phase 2/3's `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `N8N_WEBHOOK_SECRET` — this module reuses all four.

## Database changes

Migration `0010_calendar_tasks_reminders.sql`: extends `tasks` (category, reminder_at, related_email_id, notes, ai_priority_reason, ai_suggested; status/priority vocabulary aligned to the spec), adds `calendar_events` (never actually built before this phase, despite being sketched early on), generalizes `reminders` to also target `calendar_event_id`, and adds `recurring_tasks`, `activity_logs`, `daily_briefings`, `weekly_reviews`. Migration `0011_task_prompts.sql` seeds the `natural_language_task` and `weekly_review` prompts.

`recurring_tasks` and `activity_logs` — new tables, not yet surfaced in the dashboard UI (no recurring-task management page, no activity feed page). They're fully functional on the backend (the scheduler reads/writes `recurring_tasks`; nothing writes `activity_logs` yet since no workflow was wired to log to it this phase — flagging this as unfinished rather than done: **`activity_logs` is currently unused**, a placeholder for a future Activity feed page, not yet written to by any workflow).

## New n8n workflows

| Workflow | Trigger | Does |
|---|---|---|
| `Tasks - Create From Natural Language` | Webhook (`/task-create-nl`) | One Claude call parses free text into a task or recurring task, with inferred priority + reason |
| `Tasks - Create From Email` | Webhook (`/task-create-from-email`) | Builds a task directly from an email's existing analysis — no extra Claude call |
| `Tasks - Recurring Task Scheduler` | Schedule, hourly | Spawns real tasks from due `recurring_tasks`, advances `next_run_at` by exactly one interval (no drift) |
| `Calendar - Sync Google Calendar` | Schedule, every 15 min | Rolling 31-day window, upserts by `external_event_id`. **Doesn't detect deletions** — an event removed in Google Calendar won't disappear from our copy yet (documented limitation, not a bug) |
| `Calendar - Create Event` | Webhook (`/calendar-create-event`) | Checks Google Calendar for conflicts in the requested window, creates directly (no approval gate — see Phase 4 plan discussion), reports conflicts back |
| `Reminders - Send Due Reminders` | Schedule, every 5 min | Always creates an in-app notification; additionally sends email if the reminder's `notification_type` is `email` |
| `Briefing - Daily Morning Briefing` | Schedule, 6:00 AM Africa/Accra | Gathers due tasks, today's events, unread critical/high emails, weekly completion stats; calls the `daily_briefing` prompt (from Phase 2, reused as-is) |
| `Briefing - Weekly Review` | Schedule, Sunday 6:00 PM Africa/Accra | Completed/pending tallies + AI recommendations via the new `weekly_review` prompt |

## Post-import checklist additions

**Re-link Execute Workflow nodes:**

| Workflow | Node | Should point to |
|---|---|---|
| `Tasks - Create From Natural Language` | Call AI - Process Request | `AI - Process Request` |
| `Tasks - Recurring Task Scheduler` | *(none — no sub-workflow calls)* | — |
| `Calendar - Create Event` | Notify | `Notifications - Send Notification` |
| `Reminders - Send Due Reminders` | Notify | `Notifications - Send Notification` |
| `Briefing - Daily Morning Briefing` | Call AI - Process Request | `AI - Process Request` |
| `Briefing - Daily Morning Briefing` | Notify | `Notifications - Send Notification` |
| `Briefing - Weekly Review` | Call AI - Process Request | `AI - Process Request` |
| `Briefing - Weekly Review` | Notify | `Notifications - Send Notification` |

**Set Error Workflow** → `Core - Error Handler` on all 8 new workflows.

**Re-select credentials:**
- Gmail OAuth2 on `Reminders - Send Due Reminders`' "Send Reminder Email" node.
- Google Calendar OAuth2 on `Calendar - Sync Google Calendar`'s "List Calendar Events" node, and `Calendar - Create Event`'s "Check Conflicts" and "Create Google Calendar Event" nodes.

**Set workflow timezone to Africa/Accra** on `Briefing - Daily Morning Briefing` and `Briefing - Weekly Review` (Settings tab) — the JSON sets this, but confirm it landed after import.

**Activate the two webhook workflows** (`Tasks - Create From Natural Language`, `Tasks - Create From Email`, `Calendar - Create Event` — three, not two) and copy nothing new into `.env.local`: they share the same `N8N_WEBHOOK_BASE_URL` as the email module's webhooks, just different paths.

**Activate the 5 schedule-triggered workflows** once everything above is linked: `Tasks - Recurring Task Scheduler`, `Calendar - Sync Google Calendar`, `Reminders - Send Due Reminders`, `Briefing - Daily Morning Briefing`, `Briefing - Weekly Review`.

## Testing

1. **Natural language task creation** — on the Tasks page, try `"Call ABC School tomorrow afternoon"` and `"Remind me every Monday to check sales leads"`. Confirm the first creates a one-off task with a sensible due date and priority reason; confirm the second creates a `recurring_tasks` row, not a `tasks` row.
2. **Email to task** — open an email with `action_required = true`, click **Create task from this email**, confirm the task's title/priority/due date match the email's analysis.
3. **Recurring scheduler** — manually run `Tasks - Recurring Task Scheduler` once with a recurring task whose `next_run_at` you've set to the past (edit it directly in Supabase for the test); confirm a real task appears and `next_run_at` advances by one interval.
4. **Calendar sync** — manually run `Calendar - Sync Google Calendar`; confirm your real upcoming events appear in `calendar_events` and on the `/calendar` page.
5. **Calendar create + conflict detection** — create an event that deliberately overlaps an existing one; confirm the response reports the conflict and the event is still created (by design — see the plan).
6. **Reminders** — set a reminder a few minutes in the future on a task, wait for `Reminders - Send Due Reminders` to fire, confirm a notification appears (and an email arrives, if you set `notification_type: 'email'`).
7. **Daily briefing** — manually run `Briefing - Daily Morning Briefing`, confirm it appears on Dashboard Home with real task/calendar/email data, not placeholder text.
8. **Weekly review** — manually run `Briefing - Weekly Review`, sanity-check the completed/pending counts against what's actually in your task list.