# AI Agent Team System (Phase 7)

## Design decisions

1. **Agents are prompt-identities, not separate processes.** Each agent is a row in `agents` (name, description, capabilities) plus a persona prompt (`agent_sales`, `agent_marketing`, etc.), invoked through the same `AI - Process Request` sub-workflow every phase since Phase 2 uses. "Delegating to the Sales Agent" = the orchestrator calling `AI - Process Request` with `prompt_key: 'agent_sales'`.
2. **No `agent_activity_logs` table** — `activity_logs` (Phase 4) got an `agent_id` column instead.
3. **No separate "Daily Agent Briefing" workflow** — folds into `daily_briefing` v3 (same reasoning as Phases 5/6: one morning briefing, not competing ones).
4. **`finance_entries` and `support_tickets` are genuinely new** — nothing in Phases 1-6 tracked money or support requests.
5. **One generic orchestrator, not six agent-specific workflows.** `Agent - Orchestrate Request` prefetches context for all agents up front (pipeline, business memory, finance entries, tasks, automation runs, open tickets) and loops per selected agent — simpler than branching to six separate fetch chains, at the cost of always fetching everything regardless of which agents get selected.
6. **Sales/Operations/Marketing/Finance/Research recommendations are informational by default** — approving one just means "reviewed and accepted," nothing sends. Only **Support** ticket replies and **Marketing** content go through real approval gates with consequence (support actually emails; marketing just flips to "ready to post," no publishing integration exists).
7. **A real bug caught mid-build**: several nodes downstream of the orchestrator's per-agent loop used `$('Node').first()` to read paired upstream data — that grabs item 0 regardless of which agent is currently being processed, silently corrupting results whenever more than one agent is selected. Fixed to `.item` (the established paired-lookup accessor) throughout.
8. **Web search (Research Agent)** extends `AI - Process Request` itself (optional `enable_web_search` flag) rather than forking it — Claude's server-side web search tool needs no client-side tool loop, so the existing response-parsing only needed a fix to concatenate multiple text blocks instead of taking the first one.

## New n8n workflows

| Workflow | Trigger | Does |
|---|---|---|
| `Agent - Orchestrate Request` | Webhook (`/agent-orchestrate`) | Routes a request to agents, runs each via `AI - Process Request`, combines results, gates approval-needing outputs |
| `Agent - Handle Recommendation Decision` | Webhook (`/agent-decision`) | Generic approve/reject for `agent_outputs` with no dedicated send action |
| `Agent Support - Draft Reply` | Webhook (`/agent-support-draft`) | Vector-searches product docs (reuses Phase 6's `match_document_chunks`), drafts a ticket reply |
| `Agent Support - Handle Send Decision` | Webhook (`/agent-support-decision`) | Approved → sends a fresh email (same pattern as `School CRM - Handle Send Decision`); rejected → reopens the ticket |

Modified: `AI - Process Request` (web search flag), `KB - Monthly Business Report` (real `finance_entries` totals replace business-memory-only revenue notes), `Briefing - Daily Morning Briefing` (agent-summary section).

## Database

Migration `0016_agent_system.sql`: `agents`, `agent_tasks`, `agent_outputs`, `agent_memory`, `agent_permissions`, `finance_entries`, `support_tickets`, plus `activity_logs.agent_id`. Migration `0017_agent_prompts.sql`: `agent_router`, `agent_combine_results`, one persona prompt per agent, `daily_briefing` v3.

## New pages

`/assistant` gained a mode toggle: "Ask" (unchanged Phase 6 RAG) vs. "Delegate to agent team" (new orchestration, shows per-agent output + inline approve/reject). `/agents` (roster + pending-approvals inbox), `/finance` (income/expense log), `/support` (tickets + draft/approve/reject).

## Post-import checklist additions

Re-link Execute Workflow nodes: `Agent - Orchestrate Request`'s three `Call AI - Process Request` nodes and its `Call Request Approval` node; `Agent Support - Draft Reply`'s `Call AI - Process Request` and `Call Request Approval` nodes; `Agent Support - Handle Send Decision`'s `Notify` node. Set Error Workflow → `Core - Error Handler` on all 4 new workflows. Activate all 4 webhooks (same `N8N_WEBHOOK_BASE_URL`). No new n8n Variables — this phase reuses `VOYAGE_API_KEY` (Support Agent's doc search) and `ANTHROPIC_API_KEY` (web search rides the same key).

## Testing

1. Delegate "Prepare a plan to get 20 new schools using SchoolPro GH" from `/assistant` — confirm multiple agents run and the combined result actually synthesizes rather than just concatenating.
2. Delegate something Marketing-flavored, confirm it lands in `/agents`' pending-approvals inbox and approve/reject both work.
3. Log a few `/finance` entries, then delegate a finance question — confirm the answer is grounded in those entries, not a guess.
4. Create a ticket with a contact email on `/support`, click "Draft AI reply," approve it, and confirm a real email sends.
5. Delegate a research question and confirm the answer reflects an actual web search, not just training knowledge.
6. Manually run `Briefing - Daily Morning Briefing` and confirm the agent-summary section reflects real pending approvals/tickets.