create table if not exists public.excluded_instagram_handles (
  id bigserial primary key,
  handle text not null unique,
  reason text,
  source text,
  excluded_by text,
  created_at timestamptz default now()
);

create index if not exists idx_excluded_instagram_handles_handle
  on public.excluded_instagram_handles (handle);
