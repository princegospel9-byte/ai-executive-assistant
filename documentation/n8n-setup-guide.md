# n8n Setup Guide (Phase 2)

These workflows were written as JSON files without a live n8n instance to test-import against. That means two things need your attention after import that a normal "click import and go" flow wouldn't require. This guide covers both, plus the full import + test sequence.

## 1. Get an n8n instance

Any n8n instance works - self-hosted (a small VPS, ~$5-10/mo) or n8n Cloud. Nothing in these workflow files is hosting-specific; that decision can wait.

**Free self-hosting option (Phase 9):** `deploy/n8n/docker-compose.yml` runs n8n locally or on any machine with Docker installed, for $0/month. Copy `deploy/n8n/.env.example` to `deploy/n8n/.env`, fill in a username/password for the n8n web UI, then from `deploy/n8n/`: `docker compose up -d`. n8n is then reachable at `http://localhost:5678`. This only gets you a *running* n8n - Steps 2-6 below (Variables, migrations, import, credentials, activation) are still needed regardless of where n8n runs.

## 2. Set the required Variables

In n8n: **Settings → Variables** (if your instance doesn't show this, you're on an older/restricted setup - see the fallback note at the bottom). Create three:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Same value as `NEXT_PUBLIC_SUPABASE_URL` in the dashboard app's `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same value as `SUPABASE_SERVICE_ROLE_KEY` in the dashboard app's `.env.local` |
| `ANTHROPIC_API_KEY` | From console.anthropic.com → Settings → API Keys |

Every workflow reads these via `$vars.SUPABASE_URL` etc. - no per-workflow credential setup needed for these three.

*Fallback if your n8n instance doesn't support Variables:* every occurrence of `$vars.X` in these JSON files would need to become `$env.X`, with `X` set as an actual environment variable on the n8n process (self-hosted only - not available on n8n Cloud). Tell me if you hit this and I'll do a find-and-replace across the files.

## 3. Run the Supabase migrations

If you haven't already: run `supabase/migrations/0006_automation_foundation.sql` and `0007_seed_prompts.sql` (in that order) in the Supabase SQL Editor, same as the Phase 1 migrations.

## 4. Import the workflows

Import every `.json` file under `n8n/` (n8n's **Import from File** on the Workflows list, one at a time, or **Import from URL/Folder** if your version supports bulk import). Order doesn't matter for import itself, but do all of them before Step 5.

## 5. Post-import checklist (the part that needs your hands)

n8n doesn't export secrets or cross-workflow IDs in workflow JSON - by design, for security. So two things need reconnecting after import:

**A. Re-link every "Execute Workflow" node.** Open each of these and re-select the target workflow from the dropdown (it'll show blank/broken until you do):

| Workflow | Node | Should point to |
|---|---|---|
| `Core - Request Approval` | Notify User | `Notifications - Send Notification` |
| `Core - Error Handler` | Log The Failure | `Core - Log Execution` |
| `Core - Error Handler` | Notify User | `Notifications - Send Notification` |
| `AI - Process Request` | Log Execution | `Core - Log Execution` |
| `Testing - Logging` | Call Log Execution | `Core - Log Execution` |

**B. Set the Error Workflow on every workflow that has one.** Open each workflow's Settings (top right) and set **Error Workflow → Core - Error Handler**:

`Core - Log Execution`, `Core - Request Approval`, `Notifications - Send Notification`, `AI - Process Request`, `Testing - Error Handling`.

*(`Core - Error Handler` itself should NOT have an Error Workflow set - that would create a loop if it ever failed.)*

## 6. Run the test workflows, in this order

1. **`Testing - Supabase Connection`** - confirms `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are correct.
2. **`Testing - Claude API`** - confirms `ANTHROPIC_API_KEY` is correct.
3. **`Testing - Logging`** - confirms `Core - Log Execution` is correctly linked and actually writes a row.
4. **`Testing - Error Handling`** - confirms the Error Workflow chain works. This one is *supposed* to fail - a successful test looks like: the execution shows failed (red) in n8n, a new `automation_runs` row appears with `status=failed`, and a critical notification appears in the `notifications` table.
5. **`Testing - Gmail Connection`** - currently a stub, nothing to run yet (documented in the workflow itself).

If any of the first four fail for a reason other than "I haven't done the linking/variables step yet," tell me the exact error message from n8n's execution log and I'll fix the workflow JSON.

## 7. Verify the full AI orchestration pipeline

Once 1-4 above pass, you can manually trigger `AI - Process Request` (temporarily add a Manual Trigger node feeding it test input, or use n8n's "Test Workflow" with pinned input data) with something like:

```json
{
  "prompt_key": "knowledge_search",
  "variables": {
    "question": "What is 2+2?",
    "retrieved_context": "Basic arithmetic: 2+2=4."
  },
  "user_id": "<your real user id from the profiles table>"
}
```

Expect `output` in the response to be a plain-text answer citing the context, and new rows in both `ai_usage_log` and `automation_runs`.