# n8n Automation Foundation (Phase 2)

This is the reusable automation layer every future workflow (Email, Calendar, CRM, Daily Briefing, Knowledge Assistant) builds on. Nothing domain-specific was built this phase - only the shared plumbing.

## Folder structure & naming convention

```
n8n/
├── Core/              Error Handler, Log Execution, Request Approval
├── Notifications/      Send Notification
├── AI/                  AI - Process Request (orchestration)
├── Testing/              5 workflows that verify the foundation works
├── Email/ Calendar/ CRM/ Tasks/ School CRM/ Utilities/    Scaffolded, empty - future phases
```

Naming: `[Category] - [Description]`. This mirrors the file layout, so a workflow's name always tells you which folder it lives in.

## How workflows communicate

Two deliberately different mechanisms:

| Mechanism | Used for | Example |
|---|---|---|
| **Execute Workflow node** (synchronous call, JSON in/out) | Calling a shared component from within another workflow | Any future workflow calls `Core - Log Execution` when it finishes |
| **Shared Supabase tables** (write once, read independently later) | Anything that doesn't need an immediate answer | A workflow writes to `notifications`; the dashboard reads it whenever the user opens the app |

## Error handling

- Every real workflow should have **`Core - Error Handler`** set as its Error Workflow (n8n Settings tab → Error Workflow). This fires automatically on any unhandled node failure - no wiring needed inside the failing workflow.
- **Retries happen first, before that ever triggers.** Every HTTP Request node calling Supabase or Claude is configured with `retryOnFail: true, maxTries: 3, waitBetweenTries: 5000ms` at the node level. A transient network blip resolves itself and never reaches the Error Handler at all.
- **Important limitation, by design:** `Core - Error Handler` is triggered by n8n's own system-level Error Trigger, which only receives the failed workflow's *name* and *error message* - never its business data (no `user_id`, no related record). That's why well-built workflows log their own failures with full context via their own failure path calling `Core - Log Execution` directly; the Error Handler is the catch-all safety net for whatever slips past that, not the primary logging path.
- **Duplicate-prevention:** `Core - Request Approval` checks for an existing pending approval on the same `action_type` + `related_record_id` before creating a new one. Future polling workflows (Email, Calendar) will dedupe the same way, against stored external IDs.

## Logging

Every workflow captures a start timestamp as its first step, then - on success or failure - calls `Core - Log Execution` with:

```json
{
  "user_id": "...",
  "workflow_name": "...",
  "status": "success | failed",
  "started_at": "...",
  "error_message": "... (if failed)",
  "related_record_type": "... (optional)",
  "related_record_id": "... (optional)"
}
```

`Core - Log Execution` computes `duration_ms` itself and writes one row to `automation_runs`. It also captures n8n's own execution ID (`$execution.id`), so our log table cross-references n8n's native execution history if you ever need to dig into a specific run there.

## AI orchestration layer

`AI - Process Request` is the single reusable pattern every AI feature calls, instead of each feature hand-rolling its own Claude integration:

1. **Receive structured input** - `{ prompt_key, variables, user_id, related_record_type?, related_record_id?, feature?, model?, max_tokens? }`
2. **Load the correct system prompt** - fetched from the `prompts` table by `prompt_key` (only the active version)
3. **Send the request to Claude** - `{{variable}}` placeholders in the prompt template are filled from `variables`, then sent to `api.anthropic.com/v1/messages`
4. **Validate the response** - throws (triggering the Error Workflow) on a refusal or empty content; attempts to JSON-parse the output for prompts that expect structured output, falls back to raw text for prose prompts (daily briefing, knowledge search)
5. **Save the output** - logs token usage to `ai_usage_log`, logs the execution to `automation_runs`
6. **Return structured JSON** - `{ success, output, is_structured, prompt_key, prompt_version, usage }`

Model defaults to `claude-opus-4-8` but any caller can override (`model`, `max_tokens` in the input) - this is what lets a future feature use a cheaper model for simple classification without touching this workflow's logic.

## Prompt library

The `prompts` table is the versioned prompt library - editable without touching any workflow's logic. Seeded categories: `email_analysis`, `email_reply`, `crm_analysis`, `follow_up_suggestions`, `daily_briefing`, `school_sales`, `knowledge_search`.

**To update a prompt:** insert a new row with the same `prompt_key`, an incremented `version`, and `is_active = true`; set the old version's `is_active = false` in the same transaction. A partial unique index (`prompts_active_key_idx`) enforces that only one version per `prompt_key` can be active at a time - the database refuses a second active row, not just application discipline.

```sql
begin;
update public.prompts set is_active = false where prompt_key = 'email_reply' and is_active = true;
insert into public.prompts (prompt_key, version, category, system_prompt, user_prompt_template)
  values ('email_reply', 2, 'email_reply', '...new system prompt...', '...new template...');
commit;
```

## Approval system

Any action with real-world consequences (send an email, create a calendar event, send a WhatsApp message, update an important CRM record) must go through `Core - Request Approval` before it actually happens - it never executes the action itself, only records that it's pending and notifies you.

Input: `{ user_id, action_type, payload, related_record_type?, related_record_id? }`. `payload` is a free-form JSON object holding whatever the calling workflow needs to show you to make a decision (e.g. `{ to, subject, body }` for an email send).

The dashboard's Settings/Approvals view (not built yet - a later phase) will let you approve or reject each pending row; the calling workflow's future counterpart (also not built yet) will need to poll or be notified when a decision is made before actually executing the action. This phase only builds the "record the request and notify" half.

## Notifications

`Notifications - Send Notification` writes to the `notifications` table. `channel` is stored (`in_app` | `email` | `whatsapp`) but **only `in_app` actually delivers anywhere right now** - the dashboard's notification view (not built yet) is where these surface. Email/WhatsApp delivery activates once those integrations exist in later phases; storing the intended channel now means nothing needs to be re-architected when they do.

## What's deliberately not built yet

Per your instructions: no Gmail workflow, no Calendar workflow, no CRM workflow. `n8n/Email/`, `Calendar/`, `CRM/`, `Tasks/`, `School CRM/` exist as empty folders (each with a README noting what belongs there) so future phases have an obvious place to land without restructuring anything.