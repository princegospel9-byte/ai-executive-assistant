# AI Knowledge Base & Business Intelligence Module (Phase 6)

## Voyage AI setup (new — the one new vendor this phase needs)

Claude has no native embeddings endpoint; Anthropic's own documentation recommends Voyage AI for this, so that's what this module uses.

1. Sign up at [voyageai.com](https://voyageai.com) (free tier available).
2. Create an API key.
3. In n8n: **Settings → Variables → New** → `VOYAGE_API_KEY`.

Model used: `voyage-3.5` at 1024 dimensions, with `input_type: 'document'` when embedding chunks and `input_type: 'query'` when embedding a question — Voyage's asymmetric embedding mode, meaningfully improves retrieval quality over using the same embedding for both sides.

## Design decisions

1. **Text extraction happens in Next.js, not n8n.** PDF/DOCX/XLSX parsing needs binary-format npm packages (`pdf-parse`, `mammoth`, `xlsx`); pulling those into n8n Code nodes would break the established low-risk pattern (HTTP Request + Code nodes only, no exotic dependencies). Next.js extracts plain text server-side and hands *that* to n8n — n8n's job starts at chunk → embed → store.
2. **`xlsx` is installed from SheetJS's own CDN (`cdn.sheetjs.com`), not the npm registry.** The npm-registry version of `xlsx` carries unpatched high-severity advisories (prototype pollution, ReDoS — [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6), [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)); SheetJS only ships fixes through their own CDN. `package.json` pins `"xlsx": "https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz"`.
3. **No separate `embeddings` table.** The vector lives directly on `document_chunks.embedding` — 1:1 relationship with a chunk, so a join would only add overhead.
4. **No generic `reports` table.** The daily report is already `daily_briefings` (Phase 4, sales pipeline since Phase 5). The weekly report extends the existing `weekly_reviews` (v2 prompt, adds pipeline movement) rather than duplicating it. Only the monthly report had no Phase 4 equivalent, so only it gets a new table (`monthly_reports`).
5. **`knowledge_search` (seeded in Phase 2, migration `0007_seed_prompts.sql`) is reused unchanged** for both document RAG and the business advisor — its category comment even said "prose" ahead of time. Its `{{retrieved_context}}` variable is filled with document excerpts, live business data (memory, pipeline, tasks), or both, so one prompt answers both document questions and business-analysis questions. No new prompt row needed for the Advisor.
6. **`activity_logs` (built in Phase 4, flagged then as unused) finally gets written to** — `KB - Process Document` logs a `document_processed` entry once a document is chunked and embedded. This is the audit-log requirement from this phase's spec; it's a starting point, not written to by every workflow yet.
7. **Revenue isn't tracked anywhere in this system** — there's no invoicing/payments table in Phases 1-5. Rather than build a full invoicing subsystem (out of scope) or let the AI guess, revenue can be logged manually into `business_memory` (category `revenue`), and every report prompt is instructed to say plainly that revenue isn't tracked if nothing's been logged, instead of estimating.
8. **`monthly_business_report` returns structured JSON** (`{report_text, insights}`), not prose — the standout risks/opportunities Claude identifies become individual `ai_insights` rows for the home dashboard, always the AI's own grounded read of the month's data, never derived from hardcoded thresholds on the numbers.
9. **Two Phase 1 placeholders got repurposed/removed, since this phase finally reached them:**
   - `/assistant` ("AI Assistant... Coming in Phase 6-7") is now the real AI Advisor chat page — exactly what it was reserved for.
   - `/crm` ("CRM... Coming in Phase 4") was a placeholder that Phase 5's `/school-sales` fully superseded; it sat alongside "School Sales" in the sidebar showing nothing. Removed the route and the nav entry.

## Database changes

Migration `0014_knowledge_base.sql`: enables `pgvector`; adds `knowledge_documents`, `document_chunks` (embedding column + HNSW index), `business_memory` (full CRUD RLS — the spec requires user editing/deletion), `customer_memory` (select+update-only, AI-maintained), `ai_insights` (select+update-only), `monthly_reports` (select-only), `search_history` (full CRUD); adds the `match_document_chunks` and `increment_document_access` RPC functions; creates the private `knowledge-documents` Storage bucket with per-user path-scoped policies.

Migration `0015_kb_prompts.sql`: `weekly_review` v2 (adds pipeline movement), `monthly_business_report` v1 (new), `customer_memory_update` v1 (new — distinct shape from Phase 5's `crm_follow_up`, this one summarizes accumulated history rather than scheduling a follow-up).

## New n8n workflows

| Workflow | Trigger | Does |
|---|---|---|
| `KB - Process Document` | Webhook (`/kb-process-document`) | Chunks the already-extracted text, batch-embeds via Voyage, stores in `document_chunks`, marks the document `ready`, logs to `activity_logs` |
| `KB - Answer Question` | Webhook (`/kb-ask-advisor`) | Embeds the question, vector-searches `document_chunks`, blends in business memory/pipeline/tasks, calls `knowledge_search`, logs to `search_history`, bumps `access_count` on the documents actually used |
| `KB - Customer Activity Analysis` | Execute Workflow (from `Generate Message`) **and** Webhook (`/kb-customer-activity`) | Refreshes a school's rolling `customer_memory` summary — dual-trigger, same safe pattern as other dual-trigger workflows: automatic on real customer activity (a message just got generated for that school), or manual via the "Refresh AI summary" button |
| `KB - Monthly Business Report` | Schedule, 1st of month, 7:00 AM Africa/Accra | Pipeline movement, task throughput, KB activity, revenue notes (if logged) → `monthly_business_report` → `monthly_reports` + `ai_insights` |

Modified: `Briefing - Weekly Review` (Phase 4) gets a new "Fetch Active Pipeline" step feeding `new_leads_count`/`pipeline_summary` into `weekly_review` v2. `School CRM - Generate Message` (Phase 5) gets a new parallel branch calling `KB - Customer Activity Analysis` after a message is inserted — doesn't block or slow the webhook response, same non-blocking fan-out pattern as `Import Schools`.

## Post-import checklist additions

**Re-link Execute Workflow nodes:**

| Workflow | Node | Should point to |
|---|---|---|
| `KB - Answer Question` | Call AI - Process Request | `AI - Process Request` |
| `KB - Customer Activity Analysis` | Call AI - Process Request | `AI - Process Request` |
| `KB - Monthly Business Report` | Call AI - Process Request | `AI - Process Request` |
| `KB - Monthly Business Report` | Notify | `Notifications - Send Notification` |
| `Briefing - Weekly Review` | *(no new sub-workflow calls — only a new HTTP node)* | — |
| `School CRM - Generate Message` | Refresh Customer Memory (new) | `KB - Customer Activity Analysis` |

**Set Error Workflow** → `Core - Error Handler` on the 4 new workflows.

**New n8n Variable:** `VOYAGE_API_KEY` (see setup above) — the only addition beyond Phase 2/3's `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `N8N_WEBHOOK_SECRET`.

**Activate the 3 webhook workflows**: `KB - Process Document`, `KB - Answer Question`, `KB - Customer Activity Analysis` (its webhook trigger, specifically — the Execute Workflow trigger doesn't need separate activation). Same `N8N_WEBHOOK_BASE_URL`, no new `.env.local` entries.

**Activate the schedule-triggered workflow**: `KB - Monthly Business Report`, once its Execute Workflow links above are confirmed. Confirm its timezone landed as Africa/Accra after import.

## Testing

1. **Upload** — on `/knowledge-base`, upload a PDF, a DOCX, and a CSV. Confirm each moves from `processing` to `ready` (or `failed` with a real error message) within a minute or two.
2. **RAG answer** — on `/assistant`, ask a question whose answer is only in one of the uploaded documents (e.g. something from a product brochure). Confirm the answer is grounded in the document and cites it as a source.
3. **Business advisor question** — ask "Which schools should I follow up with this week?" with real pipeline data present; confirm the answer references actual schools/statuses, not generic advice.
4. **Business memory** — add a few entries (product, pricing, a preference) on `/knowledge-base`; ask the Advisor something that should draw on one of them; confirm it's reflected in the answer. Delete an entry and confirm it stops showing up.
5. **Customer knowledge** — generate a message for a school on `/school-sales/[id]`; confirm the "Customer knowledge" panel populates automatically without clicking anything. Click "Refresh AI summary" and confirm it updates.
6. **Search** — try "Find all information about ABC School" as a search and separately as "Ask AI instead"; confirm the keyword results link to the right pages and the AI answer is grounded.
7. **Weekly review** — manually run `Briefing - Weekly Review`; confirm the pipeline movement section reflects real data, not placeholder text.
8. **Monthly report** — manually run `KB - Monthly Business Report`; confirm it appears on `/reports`, and if anything genuinely stood out, confirm matching entries appear as AI insights on the dashboard home page.
9. **Revenue honesty check** — with no `revenue` category memory entries logged, ask the Advisor or check a report's business-performance section; confirm it says revenue isn't tracked rather than guessing a number.