-- Phase 6: AI Knowledge Base & Business Intelligence. Two deliberate
-- deviations from the spec's literal table list, same "reuse over
-- proliferation" reasoning as every prior phase - see
-- documentation/knowledge-base-module.md:
--   - no separate "embeddings" table: the vector lives on document_chunks
--     directly (1:1 relationship, avoids a join on every retrieval query).
--   - no generic "reports" table: the daily report is already
--     daily_briefings (Phase 4, includes sales pipeline since Phase 5) and
--     the weekly report extends the existing weekly_reviews (see
--     0015_weekly_review_v2.sql) rather than duplicating it. Only the
--     monthly report is genuinely new, so only it gets a new table.

create extension if not exists vector;

-- ── knowledge_documents ──────────────────────────────────────────────────
create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  file_type text not null, -- 'pdf' | 'docx' | 'txt' | 'csv' | 'xlsx'
  status text not null default 'processing', -- 'processing' | 'ready' | 'failed'
  error_message text,
  access_count integer not null default 0,
  uploaded_at timestamptz not null default now()
);

create index knowledge_documents_user_id_idx on public.knowledge_documents(user_id);
create index knowledge_documents_status_idx on public.knowledge_documents(status);

alter table public.knowledge_documents enable row level security;

create policy "Users manage their own documents"
  on public.knowledge_documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── document_chunks (embedding column folded in - see note above) ───────
create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1024), -- voyage-3.5, 1024 dimensions
  token_count integer,
  created_at timestamptz not null default now()
);

create index document_chunks_document_id_idx on public.document_chunks(document_id);
create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

alter table public.document_chunks enable row level security;

-- select-only from the browser - chunks are n8n-written during ingestion,
-- same reasoning as generated_messages/draft_replies in Phases 3/5.
create policy "Users view their own document chunks"
  on public.document_chunks for select
  using (auth.uid() = user_id);

-- ── match_document_chunks: cosine-similarity search via pgvector ────────
create or replace function public.match_document_chunks(
  query_embedding vector(1024),
  match_user_id uuid,
  match_count int default 6
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    document_chunks.id,
    document_chunks.document_id,
    document_chunks.content,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from public.document_chunks
  where document_chunks.user_id = match_user_id
    and document_chunks.embedding is not null
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- Bumps access_count on whatever documents actually got retrieved for a
-- given Advisor/search answer - feeds the "most accessed" Knowledge Base
-- stat. No-ops safely on an empty array (nothing retrieved).
create or replace function public.increment_document_access(doc_ids uuid[])
returns void
language sql
as $$
  update public.knowledge_documents
  set access_count = access_count + 1
  where id = any(doc_ids);
$$;

-- ── business_memory ──────────────────────────────────────────────────────
-- Full CRUD from the browser (unlike the AI-written tables above) - the
-- spec explicitly requires the user can edit/delete these directly.
create table public.business_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null, -- 'product' | 'pricing' | 'strategy' | 'preference' | 'goal' | 'challenge' | 'revenue'
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, category, key)
);

create index business_memory_user_id_idx on public.business_memory(user_id);

alter table public.business_memory enable row level security;

create policy "Users manage their own business memory"
  on public.business_memory for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── customer_memory (reuses schools as "customer", not a new concept) ───
create table public.customer_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  summary text,
  preferences text,
  last_updated timestamptz not null default now(),
  unique (user_id, school_id)
);

alter table public.customer_memory enable row level security;

-- select+update-only - AI-maintained, refreshed by KB - Customer Activity
-- Analysis, same reasoning as customer-facing AI output elsewhere.
create policy "Users view their own customer memory"
  on public.customer_memory for select
  using (auth.uid() = user_id);

create policy "Users edit their own customer memory"
  on public.customer_memory for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── ai_insights ───────────────────────────────────────────────────────────
create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null, -- 'risk' | 'opportunity' | 'recommendation'
  related_school_id uuid references public.schools(id) on delete set null,
  title text not null,
  detail text not null,
  status text not null default 'new', -- 'new' | 'acknowledged' | 'dismissed'
  created_at timestamptz not null default now()
);

create index ai_insights_user_id_status_idx on public.ai_insights(user_id, status);

alter table public.ai_insights enable row level security;

create policy "Users view their own AI insights"
  on public.ai_insights for select
  using (auth.uid() = user_id);

create policy "Users acknowledge or dismiss their own AI insights"
  on public.ai_insights for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── monthly_reports ───────────────────────────────────────────────────────
create table public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  content_text text not null,
  content_json jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, period_start)
);

alter table public.monthly_reports enable row level security;

create policy "Users view their own monthly reports"
  on public.monthly_reports for select
  using (auth.uid() = user_id);

-- ── search_history ────────────────────────────────────────────────────────
create table public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  result_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index search_history_user_id_created_at_idx on public.search_history(user_id, created_at desc);

alter table public.search_history enable row level security;

create policy "Users manage their own search history"
  on public.search_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Storage: private bucket for uploaded documents ──────────────────────
insert into storage.buckets (id, name, public)
values ('knowledge-documents', 'knowledge-documents', false)
on conflict (id) do nothing;

-- Objects are stored under `{user_id}/{document_id}/{filename}` - policies
-- scope access to the path's leading folder matching the caller's uid,
-- same pattern Supabase's own docs recommend for per-user private buckets.
create policy "Users manage their own documents in storage"
  on storage.objects for all
  using (bucket_id = 'knowledge-documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'knowledge-documents' and (storage.foldername(name))[1] = auth.uid()::text);