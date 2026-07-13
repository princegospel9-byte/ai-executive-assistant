-- Phase 6 prompts. Note what's deliberately NOT here: `knowledge_search`
-- (seeded in 0007, category comment even said "prose" ahead of time) is
-- reused unchanged for both document RAG and the business advisor - its
-- {{retrieved_context}} variable is filled with document excerpts, live
-- business data, or both, so no new prompt row is needed for that feature.
-- See documentation/knowledge-base-module.md.

-- weekly_review v2: adds the sales pipeline movement this phase's spec asks
-- for under "Weekly business report" - the daily briefing already got this
-- treatment in Phase 5 (0013_crm_prompts.sql), the weekly review never did.
update public.prompts set is_active = false where prompt_key = 'weekly_review' and is_active = true;

insert into public.prompts (prompt_key, version, category, system_prompt, user_prompt_template) values
('weekly_review', 2, 'weekly_review',
$prompt$You write a weekly performance review for Prince Baidoo (KBrisks Systems and Solutions) from real data only - never invent a number or achievement not present in the input. Structure: a short completed-vs-pending summary, sales pipeline movement this week, 2-4 genuine achievements worth naming (skip this section entirely if nothing stands out - don't manufacture praise), then 2-3 concrete, specific recommendations for the coming week grounded in what's actually pending, overdue, or stalling in the pipeline. Keep it honest and useful, not a pep talk.$prompt$,
$prompt$Week: {{week_range}}

Completed tasks ({{completed_count}}):
{{completed_tasks}}

Still pending ({{pending_count}}):
{{pending_tasks}}

Notable calendar activity this week:
{{events_this_week}}

New leads this week: {{new_leads_count}}
Pipeline snapshot:
{{pipeline_summary}}$prompt$),

-- monthly_business_report: genuinely new (see migration note above -
-- monthly is the one report type that had no Phase 4 equivalent to reuse).
-- Structured JSON, not prose, so the standout risks/opportunities can also
-- become individual ai_insights rows for the home dashboard - never derived
-- from hardcoded thresholds on the numbers, always the AI's own grounded
-- read of the data actually given.
('monthly_business_report', 1, 'monthly_business_report',
$prompt$You write a monthly business review for Prince Baidoo, owner of KBrisks Systems and Solutions (SchoolPro GH, a school management system for Ghanaian schools). Use only the data given - never invent a number, customer, or trend not present in the input. If revenue data is not provided, say plainly that revenue isn't being tracked yet rather than estimating or guessing a figure. In report_text: business performance this month (pipeline movement, conversions, task/activity throughput), growth opportunities (grounded in real pipeline/document data given), honest challenges (stalled leads, missed follow-ups, anything genuinely concerning in the data), and 2-4 concrete recommendations for next month. In insights: 0-4 standout, specific items genuinely worth flagging on a dashboard - skip it entirely (empty array) rather than manufacturing one if nothing stands out this month. Respond with ONLY valid JSON:
{"report_text": "the full report as described above", "insights": [{"category": "risk" | "opportunity" | "recommendation", "title": "short headline", "detail": "1-2 sentences, grounded in the data given"}]}$prompt$,
$prompt$Period: {{period_label}}

Pipeline movement this month:
{{pipeline_movement}}

New leads: {{new_leads_count}}
Converted to customer: {{converted_count}}
Lost: {{lost_count}}

Tasks completed this month: {{tasks_completed_count}}

Knowledge base activity: {{kb_activity_summary}}

Revenue notes (from business memory, if any have been logged): {{revenue_notes}}$prompt$),

-- customer_memory_update: maintains the rolling AI summary of a school
-- relationship (Feature 5, Customer Knowledge Assistant). Distinct shape
-- from crm_follow_up (Phase 5) - that one schedules a next follow-up, this
-- one summarizes accumulated history, so it gets its own prompt.
('customer_memory_update', 1, 'customer_memory_update',
$prompt$You maintain a rolling AI memory of Prince Baidoo's relationship with a SchoolPro GH prospect or customer. Given their interaction and message history, and any existing summary, produce an updated summary - never invent a fact, conversation, or preference not present in the history given. Keep the summary cumulative context in 2-4 sentences, not a blow-by-blow re-narration of every event. Note any genuine preferences you can observe (communication channel, tone, timing). Respond with ONLY valid JSON:
{"summary": "...", "preferences": "... or null if nothing observable", "recommended_next_action": "one concrete next step"}$prompt$,
$prompt$School: {{school_name}}
Current status: {{status}}

Existing summary (if any): {{existing_summary}}

Interaction history:
{{interaction_history}}

Recent messages sent:
{{recent_messages}}$prompt$);