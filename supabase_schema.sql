create table if not exists public.beauty_seller_candidates (
  id bigserial primary key,
  seller_name text not null,
  channel text default 'instagram',
  profile_url text,
  grade text,
  matched_hashtags_count integer default 0,
  matched_hashtags text,
  category text,
  beauty_score integer default 0,
  selling_score integer default 0,
  negative_score integer default 0,
  combination_score integer default 0,
  combination_grades text,
  total_likes integer default 0,
  total_comments integer default 0,
  matched_beauty_keywords text,
  matched_selling_keywords text,
  negative_keywords text,
  beauty_anchor_tags text,
  commercial_signal_tags text,
  format_signal_tags text,
  dm_available text,
  sample_post_urls text,
  notes text,
  review_status text default U&'\BBF8\D655\C778',
  dm_status text default U&'\BBF8\BC1C\C1A1',
  brand_fit text,
  assignee text,
  memo text,
  status_updated_by text,
  status_updated_at timestamptz,
  last_contacted_at timestamptz,
  source_file text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (seller_name)
);

alter table public.beauty_seller_candidates
  add column if not exists assignee text,
  add column if not exists status_updated_by text,
  add column if not exists status_updated_at timestamptz,
  add column if not exists last_contacted_at timestamptz;

alter table public.beauty_seller_candidates
  alter column review_status set default U&'\BBF8\D655\C778',
  alter column dm_status set default U&'\BBF8\BC1C\C1A1';

update public.beauty_seller_candidates
set review_status = U&'\BBF8\D655\C778'
where review_status is null or review_status in ('', 'DM');

update public.beauty_seller_candidates
set dm_status = U&'\BBF8\BC1C\C1A1'
where dm_status is null or dm_status in ('', 'DM');

create index if not exists idx_beauty_seller_candidates_grade
  on public.beauty_seller_candidates (grade);

create index if not exists idx_beauty_seller_candidates_review_status
  on public.beauty_seller_candidates (review_status);

create index if not exists idx_beauty_seller_candidates_dm_status
  on public.beauty_seller_candidates (dm_status);

create index if not exists idx_beauty_seller_candidates_assignee
  on public.beauty_seller_candidates (assignee);

create index if not exists idx_beauty_seller_candidates_scores
  on public.beauty_seller_candidates (combination_score desc, beauty_score desc, selling_score desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_beauty_seller_candidates_updated_at on public.beauty_seller_candidates;
create trigger trg_beauty_seller_candidates_updated_at
before update on public.beauty_seller_candidates
for each row execute function public.set_updated_at();
