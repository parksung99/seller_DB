alter table public.beauty_seller_candidates
  add column if not exists seller_id text,
  add column if not exists follower_count integer default 0,
  add column if not exists avg_likes integer default 0,
  add column if not exists avg_comments integer default 0,
  add column if not exists engagement_rate numeric(10, 4),
  add column if not exists engagement_post_count integer default 0,
  add column if not exists engagement_posts text,
  add column if not exists last_engagement_refresh_at timestamptz,
  add column if not exists engagement_refresh_error text;

update public.beauty_seller_candidates
set seller_id = lower(regexp_replace(coalesce(seller_name, ''), '^@', ''))
where (seller_id is null or seller_id = '')
  and seller_name is not null
  and seller_name <> '';

create unique index if not exists ux_beauty_seller_candidates_seller_id
  on public.beauty_seller_candidates (seller_id)
  where seller_id is not null and seller_id <> '';
