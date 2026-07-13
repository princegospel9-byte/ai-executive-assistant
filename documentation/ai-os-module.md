# AI Autonomous Business Operating System (Phase 9)

## What this phase actually is

Mostly consolidation, not new build. Several of the spec's 14 "modules" already existed under different names by Phase 8. This document leads with that mapping so the reuse decisions are legible.

| Spec module | Reality |
|---|---|
| Module 1, Business Command Center | **New page** (`/command-center`) — but every data point on it already existed; this just aggregates |
| Module 11, Autonomous Agent Coordination | **Already built**, Phase 7's `Agent - Orchestrate Request` |
| Module 12, Approval Center | **Already built**, `approvals` (Phase 3) |
| Module 10, Risk Management (`risk_alerts`) | `ai_insights` (Phase 6/7) extended with `severity`/`mitigation_plan`/`resolved_at`, not a new table |
| Module 7, Company Knowledge Graph | **New**, but a relational join table (`entity_relationships`), not a graph database |
| Module 3, Predictive Analytics | **New**, but Claude trend-reasoning over logged history, not a statistical/ML model — see honesty note below |
| Module 9, Goal Management | **New** (`company_goals`/`goal_progress`) |
| Module 13, Learning System | **New** (`system_learning`), wired into one concrete integration point, not every decision workflow |
| Module 8, executive reports | Daily = `daily_briefings` (Phase 4), weekly = `weekly_reviews` (Phase 4), monthly = `monthly_reports` (Phase 6) — all already exist. Only quarterly/annual are new this phase |
| Module 14, Plug-in Architecture | Not a build item — it's the pattern every phase has followed (new domain = table + RLS + prompts + page). Documented as a pattern, not built as scaffolding for hypothetical HR/Inventory/Church/Hotel modules |

## Honesty note: "predictive analytics" and "business health score"

- **Forecasts** (`business_predictions`) are Claude reasoning over `business_metrics` snapshot history — genuinely useful trend commentary with stated confidence, but not a statistical or ML forecasting model. Confidence is forced to `low` whenever there are fewer than 3 historical snapshots, regardless of what the model claims, so early use doesn't overstate certainty.
- **Business health score** (Command Center) is a plain, inspectable formula (`lib/business/health-score.ts`) — task completion rate, pipeline activity, risk exposure, revenue trend, equally weighted. It's deliberately not an AI-generated number, so a low score is always explainable by looking at its four components.
- **Customer satisfaction and team activity** are shown as "not tracked" on the Command Center rather than fabricated — there's no CSAT/NPS mechanism anywhere in the system, and this is a solo-operator system with no team member records.

## Database

Migration `0020_ai_os.sql`: extends `ai_insights`; adds `business_metrics`, `company_goals`, `goal_progress`, `business_predictions`, `executive_reports` (quarterly/annual only), `system_learning`, `entity_relationships`; expands the agent roster to 8 (adds Knowledge, Reporting). Migration `0021_ai_os_prompts.sql`: `agent_knowledge`, `agent_reporting`, `revenue_forecast`, `goal_progress_analysis`, `quarterly_annual_report`, and `daily_briefing` v4 (adds goal progress + risk alerts).

## New n8n workflows

| Workflow | Trigger | Does |
|---|---|---|
| `Goals - Analyze Progress` | Webhook (`/goals-analyze-progress`) | Computes current value (auto for `customer_count` goals via the CRM), calls `goal_progress_analysis`, logs a `goal_progress` entry |
| `AI OS - Update Knowledge Graph` | Execute Workflow + Webhook (`/update-knowledge-graph`) | Generic upsert into `entity_relationships` — a reusable core primitive, same pattern as `AI - Process Request`/`Core - Request Approval` |
| `AI OS - Snapshot Business Metrics` | Schedule, daily 11:45 PM | Writes today's `business_metrics` row (customers, leads, income/expense, tasks) |
| `AI OS - Forecast Revenue` | Schedule (monthly) + Webhook (`/forecast-revenue`) | Trend-reasons over `business_metrics` history into a `business_predictions` row |
| `AI OS - Generate Executive Report` | Schedule (quarterly + annual) + Webhook (`/generate-executive-report`) | One workflow, `report_type` parameterizes the window — avoids two near-identical workflows |

Modified: `Voice - Process Meeting Recording` (Phase 8) — action-item tasks now also get linked to their meeting in `entity_relationships`, the one concrete example of the knowledge graph pattern wired into an existing workflow. `Agent - Handle Recommendation Decision` (Phase 7) — every approve/reject on an agent recommendation now logs a `system_learning` row; this is the one integration point for Module 13, not extended to Email/CRM/Support's own separate decision workflows.

## Deployment

`deploy/n8n/docker-compose.yml` — free self-hosting for n8n (Docker, any machine, $0/month), closing the hosting question left open since Phase 6. Documented in `documentation/n8n-setup-guide.md`. Next.js stays on Vercel, unchanged. Supabase stays managed, unchanged.

## Security

Nothing new to build for RLS/encryption/audit logging/approval gating — all inherited from Phases 1-8 and already applied to every new table this phase. **Flagged, not built:** rate limiting on n8n's webhook endpoints. n8n itself doesn't expose simple per-IP throttling in workflow JSON; the honest fix is a reverse proxy (Caddy/nginx) or Cloudflare's free tier in front of the webhook URL, which is an infrastructure decision for wherever n8n ends up hosted, not something these workflow files can enforce themselves.

## New pages

`/command-center` (aggregated overview), `/goals` (CRUD + AI progress analysis), `/reports` (extended with forecasts, quarterly/annual reports, on-demand generation buttons).

## Testing

1. Log a few `/finance` entries across a couple of days, manually run `AI OS - Snapshot Business Metrics` twice on different dates, then use the "Forecast next month's revenue" button on `/reports` — confirm confidence is `low` (fewer than 3 snapshots) and the reasoning references your actual numbers.
2. Create a `customer_count` goal on `/goals`, click "Analyze progress," confirm the current value matches your real CRM customer count.
3. Record a test meeting (Phase 8), then check that its action-item tasks produced `entity_relationships` rows (`select * from entity_relationships where from_type = 'meeting_transcript'`).
4. Approve or reject an agent recommendation from `/agents`, then confirm a `system_learning` row was written.
5. Generate a quarterly report on demand from `/reports`, confirm it reflects real pipeline/goal data and standout items also appear as `ai_insights`.
6. Check `/command-center` renders correctly with zero data (a fresh account) — confirm it shows honest "not tracked"/zero states rather than erroring.