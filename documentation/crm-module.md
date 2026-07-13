# School CRM & Sales Assistant Module (Phase 5)

## Design decision: reuse over new tables

The Phase 5 spec listed `leads`, `interactions`, `followups`, `messages`, and `organizations` as target tables. This module deliberately does **not** create `leads`, `interactions`, or `followups` — it extends what already existed instead:

| Spec asked for | Actually used | Why |
|---|---|---|
| `leads` | `schools` (Phase 1) | Same shape (school name, contact, pipeline stage, interest level) — a second table would just be `schools` renamed |
| `interactions` | `school_interactions` (Phase 1) | Already tracks call/visit/email/demo/proposal/note with `next_action`; this phase only adds `objections` |
| `followups` | `tasks` (Phase 4) | A follow-up is a task with a due date; `related_school_id` links it back |
| `messages` | new `generated_messages` table | Genuinely new — nothing in Phases 1-4 covers AI-drafted, channel-aware (email/WhatsApp) sales messages |
| `organizations` | `organizations` / `contacts` (Phase 1, previously unwired) | `schools` now optionally links to both via `organization_id` / `contact_id`, wired for the first time this phase |

The Phase 2 placeholder folder `n8n/CRM` and its seeded-but-unused `crm_analysis` / `follow_up_suggestions` prompt keys (migration `0007_seed_prompts.sql`) predate this design and are superseded by `n8n/School CRM` and the `crm_follow_up` / `crm_message` / `crm_insights` prompts below. They were left in place rather than removed, since deleting them wasn't part of this phase's task — flagging for awareness.

## No new OAuth setup

This module reuses the Gmail send capability built in Phase 3 (`gmailOAuth2` credential) for approved email sends — nothing new to authorize. WhatsApp messages are drafted and copied for manual sending (see **Scope decisions** below), so no WhatsApp Business API integration was built.

## New n8n Variable

None beyond Phase 2/3's `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `N8N_WEBHOOK_SECRET`.

## Scope decisions

1. **WhatsApp is draft-and-copy, not send.** There's no first-party WhatsApp Business API credential set up, and sending WhatsApp programmatically needs Meta's approval process. `Generate Message` drafts WhatsApp text and the dashboard gives a "Copy text" + "Mark as sent" button — you paste it into WhatsApp yourself. Email is fully automated end-to-end (draft → approve → send) since Gmail send already existed.
2. **Follow-up suggestions run 15 minutes before the daily briefing** (5:45 AM vs 6:00 AM Africa/Accra) so the briefing can reference tasks the follow-up assistant just created.
3. **The daily sales briefing is folded into the existing morning briefing**, not a separate briefing — see the `daily_briefing` v2 prompt below.

## Database changes

Migration `0012_crm_module.sql`:
- Three new unique constraints needed for upsert-by-name/email in the import workflow: `organizations_user_name_unique`, `contacts_user_email_unique`, `schools_user_school_name_unique`.
- `schools` gains `lead_source`, `first_contacted_at`, `organization_id`, `contact_id`; the 7-stage status vocabulary from Phase 1 is realigned to the 8-stage one from the spec (`not_contacted`→`new_lead`, `demo_done`→`demo_completed`, `proposal_sent`→`negotiating`, `won`→`customer`, `lost`→`lost_lead`).
- `school_interactions` gains `objections`.
- `tasks` gains `related_school_id`.
- New `generated_messages` table (`message_type`, `channel`, `subject`, `content`, `status`, `approval_id`) — SELECT+UPDATE-only RLS, same reasoning as `draft_replies` in Phase 3: sends are routed through the approval webhook, never a direct browser write.

Migration `0013_crm_prompts.sql` seeds `crm_follow_up`, `crm_message`, `crm_insights` (v1), and deactivates `daily_briefing` v1 in favor of v2 (adds `sales_priorities` / `pipeline_summary` template variables).

## New n8n workflows

| Workflow | Trigger | Does |
|---|---|---|
| `School CRM - Import Schools` | Webhook (`/crm-import-schools`) | Per row: upsert organization → upsert contact → upsert school, linked together |
| `School CRM - Suggest Follow-ups` | Schedule, 5:45 AM Africa/Accra | Finds schools with a due or missing follow-up date, calls `crm_follow_up` per school, creates a task **and** a draft WhatsApp follow-up message |
| `School CRM - Generate Message` | Webhook (`/crm-generate-message`) | `{school_id, message_type, channel}` → `crm_message` prompt → saves to `generated_messages`; email drafts also get an approval record (`approval_id` returned in the response so the UI can act on it immediately) |
| `School CRM - Handle Send Decision` | Webhook (`/crm-send-decision`) | Approve/reject a drafted email; the only workflow allowed to actually send a CRM email |
| `School CRM - Generate Insights` | Webhook (`/crm-generate-insights`) | No body needed — fetches the active pipeline (excludes `lost_lead`), calls `crm_insights`, returns prose insights plus `pipeline_counts` |

`Briefing/Briefing - Daily Morning Briefing` (Phase 4, modified): a new "Fetch Active Pipeline" step feeds `sales_priorities` and `pipeline_summary` into the existing `daily_briefing` prompt call, and `pipeline_counts` is stored alongside the briefing.

## Post-import checklist additions

**Re-link Execute Workflow nodes:**

| Workflow | Node | Should point to |
|---|---|---|
| `School CRM - Suggest Follow-ups` | Call AI - Process Request | `AI - Process Request` |
| `School CRM - Generate Message` | Call AI - Process Request | `AI - Process Request` |
| `School CRM - Generate Message` | Call Request Approval | `Core - Request Approval` |
| `School CRM - Handle Send Decision` | Notify | `Notifications - Send Notification` |
| `School CRM - Generate Insights` | Call AI - Process Request | `AI - Process Request` |
| `Briefing - Daily Morning Briefing` | *(no new sub-workflow calls — only a new HTTP node)* | — |

**Set Error Workflow** → `Core - Error Handler` on all 5 new workflows.

**Re-select credentials:** none new — `School CRM - Handle Send Decision` reuses the Gmail OAuth2 credential already selected in the Phase 3 email-sending workflows.

**Set workflow timezone to Africa/Accra** on `School CRM - Suggest Follow-ups` (Settings tab) — confirm after import.

**Activate the 4 webhook workflows**: `Import Schools`, `Generate Message`, `Handle Send Decision`, `Generate Insights`. They share the existing `N8N_WEBHOOK_BASE_URL` — no new `.env.local` entries.

**Activate the schedule-triggered workflow**: `Suggest Follow-ups`, once its Execute Workflow links above are confirmed.

## Testing

1. **Import** — on `/school-sales`, import a small CSV (`school_name, location, student_population, contact_person, phone, email, current_software_system, lead_source`); confirm schools appear with `status = new_lead` and linked `organizations`/`contacts` rows.
2. **Status pipeline** — change a school's stage via the dropdown on `/school-sales/[id]`; confirm it persists and the pipeline counts on `/school-sales` update.
3. **Follow-up suggestions** — manually run `School CRM - Suggest Follow-ups` against a school with a past or missing `next_follow_up_date`; confirm a task appears (linked via `related_school_id`) and a draft WhatsApp message appears in that school's message history.
4. **Message generation (WhatsApp)** — generate a `follow_up` WhatsApp message from the school detail page; confirm "Copy text" and "Mark as sent" work and the message's status updates.
5. **Message generation (email) + approval** — generate an `introduction` email; confirm "Approve & send" / "Reject" buttons appear (this is what the `approval_id` returned by `Generate Message` drives), approve one, and confirm the email actually sends via `Handle Send Decision`.
6. **Insights** — click "Generate insights" on `/school-sales`; confirm the prose response reflects your actual pipeline counts, not placeholder text.
7. **Daily briefing** — manually run `Briefing - Daily Morning Briefing`; confirm the sales section reflects real pipeline data (hot leads, overdue follow-ups) alongside the existing tasks/calendar/email sections.