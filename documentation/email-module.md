# Email Module (Phase 3)

## Gmail OAuth setup

n8n needs its own Google Cloud OAuth credential — this is separate from anything in Supabase.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project (or reuse one) → **APIs & Services → Library** → enable **Gmail API**.
2. **APIs & Services → OAuth consent screen** — set it up (External is fine for personal use; add your own Gmail address as a test user if it stays in "Testing" publishing status).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** — type **Web application**. Under "Authorized redirect URIs" add:
   ```
   https://<your-n8n-host>/rest/oauth2-credential/callback
   ```
   (For n8n Cloud this is shown to you automatically when you create the credential in n8n — copy it from there instead of guessing.)
4. Copy the **Client ID** and **Client Secret**.
5. In n8n: **Credentials → New → Gmail OAuth2 API**. Paste the Client ID/Secret, click **Connect my account**, sign in with the Gmail account you want to use, approve.

**Scopes needed** — when prompted during the Google consent screen, only these two are required (least-privilege, matching "never delete emails"):
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`

Do **not** grant `gmail.modify` or full Gmail access — this system never needs to delete, archive, or modify existing mail, only read and send new replies.

## How the workflows use it

Every Gmail call in this module goes through n8n's **HTTP Request** node with **Predefined Credential Type → Gmail OAuth2** selected (not n8n's dedicated Gmail node — same reliability reasoning as the rest of this build: plain REST calls to a stable, documented API are safer to hand-author than a node whose parameter schema I can't verify without a live instance). After import, every HTTP node that calls `gmail.googleapis.com` needs this credential re-selected — see the checklist below.

## New n8n Variable

Alongside the three from Phase 2, add one more in **Settings → Variables**:

| Variable | Value |
|---|---|
| `N8N_WEBHOOK_SECRET` | Any long random string you generate yourself (e.g. `openssl rand -hex 32`) |

This must **exactly match** `N8N_WEBHOOK_SECRET` in the dashboard app's `.env.local` — it's the shared secret that stops anyone who finds a webhook URL from triggering a real email send.

## Database changes

Two new migrations: `0008_email_module.sql` (`email_accounts`, `emails`, `email_analysis`, `email_attachments`, `draft_replies`) and `0009_email_prompts_v2.sql` (upgrades `email_analysis`/`email_reply` prompts to the richer field set and tone support). Full table-by-table explanation lives in `database-schema.md` — add this section there once you're ready to keep that doc current; the column comments in the migration SQL itself are the authoritative reference for now.

One RLS note specific to this module: `emails`, `email_accounts`, and `draft_replies` deliberately have **no delete policy at all** for the `authenticated` role — "never delete emails" is enforced at the database layer, not just by the workflows choosing not to.

## AI prompt usage

`email_analysis` (v2) returns category, priority + reason, sentiment, action_required, suggested_deadline, suggested_next_step, and labels — the full field set this phase needs, versus the Phase 2 placeholder. `email_reply` (v2) adds a `{{tone}}` variable supporting professional/friendly/formal/short/detailed. Both called through the existing `AI - Process Request` workflow — no new direct Claude integration.

## New n8n workflows (`n8n/Email/`)

| Workflow | Trigger | Does |
|---|---|---|
| `Email - Poll Gmail Inbox` | Schedule, every 10 min | Lists new Gmail messages since last sync, parses headers/body/attachments, stores them, kicks off analysis per new email |
| `Email - Analyze Email` | Called internally | Runs `AI - Process Request` with `email_analysis`, stores the result, auto-triggers a draft when a reply is actually warranted |
| `Email - Generate Draft Reply` | Called internally **or** webhook (`/email-generate-draft`) | Supersedes any existing pending draft, generates a new one via `AI - Process Request` with `email_reply`, creates the approval record |
| `Email - Handle Approval Decision` | Webhook (`/email-approval-decision`) | The **only** workflow allowed to send — sends via Gmail API only on `decision: "approved"`, threads correctly via `In-Reply-To`/`References` |

## Post-import checklist additions (on top of the Phase 2 checklist)

**Re-link Execute Workflow nodes:**

| Workflow | Node | Should point to |
|---|---|---|
| `Email - Poll Gmail Inbox` | Call Analyze Email | `Email - Analyze Email` |
| `Email - Analyze Email` | Call AI - Process Request | `AI - Process Request` |
| `Email - Analyze Email` | Call Generate Draft Reply | `Email - Generate Draft Reply` |
| `Email - Generate Draft Reply` | Call AI - Process Request | `AI - Process Request` |
| `Email - Generate Draft Reply` | Call Request Approval | `Core - Request Approval` |
| `Email - Handle Approval Decision` | Notify Sent | `Notifications - Send Notification` |

**Set Error Workflow** (Settings → Error Workflow → `Core - Error Handler`) on: all four workflows above.

**Re-select Gmail credential** on every HTTP node whose name mentions Gmail: `Get Gmail Profile`, `List New Messages`, `Get Message Detail` (in Poll Gmail Inbox), `Send Gmail Message` (in Handle Approval Decision).

**Activate the two webhook workflows** (`Email - Generate Draft Reply`, `Email - Handle Approval Decision`) — toggle Active in n8n, since a webhook URL only resolves to its production path once the workflow is active. Copy each workflow's production webhook URL (n8n shows it on the Webhook node) into `N8N_WEBHOOK_BASE_URL` in the dashboard's `.env.local` — both webhooks share the same base host, just different paths (`/email-generate-draft`, `/email-approval-decision`).

**Activate `Email - Poll Gmail Inbox`** once everything above is linked and tested — this is the one that starts pulling real mail every 10 minutes.

## Testing

Run in this order, same "tell me the exact error" approach as Phase 2 if something fails:

1. **Gmail connection** — manually run `Email - Poll Gmail Inbox` once. Check `email_accounts` in Supabase for a new row with your Gmail address, and `emails` for anything received in the last 24 hours (first-run window).
2. **Email retrieval** — confirm a real email's `subject`/`body_text`/`from_address` in the `emails` table match what's actually in your inbox.
3. **AI analysis** — confirm a matching row exists in `email_analysis` with a sensible `category`/`priority`/`summary`.
4. **Draft generation** — for an email where `action_required = true`, confirm a `draft_replies` row exists with `status = 'pending'` and a linked `approvals` row.
5. **Dashboard** — open `/email`, confirm the list renders with badges; open one with a pending draft, confirm the draft panel shows the text.
6. **Approval workflow, end to end** — on a real (or test) email, edit the draft text, click **Approve & send**, confirm: the reply actually arrives (check the recipient inbox or send a test to yourself), `draft_replies.status` becomes `sent`, `approvals.status` becomes `approved`, and a notification row appears.
7. **Reject path** — on a different draft, click **Reject**, confirm no email was sent and both rows show `rejected`.
8. **Regenerate** — change the tone dropdown and click **Regenerate**, confirm the old draft's status becomes `superseded` and a new `pending` one appears after a refresh.

**Never test the approve flow on a real client or lead email until you've confirmed it works correctly on a test message to yourself first** — the send is real and immediate once approved.