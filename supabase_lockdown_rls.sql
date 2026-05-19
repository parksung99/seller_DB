alter table public.beauty_seller_candidates enable row level security;

drop policy if exists "beauty_seller_candidates_select" on public.beauty_seller_candidates;
drop policy if exists "beauty_seller_candidates_insert" on public.beauty_seller_candidates;
drop policy if exists "beauty_seller_candidates_update" on public.beauty_seller_candidates;
drop policy if exists "beauty_seller_candidates_delete" on public.beauty_seller_candidates;
drop policy if exists "allow_all_beauty_seller_candidates" on public.beauty_seller_candidates;
drop policy if exists "public_read_beauty_seller_candidates" on public.beauty_seller_candidates;
drop policy if exists "anon_read_beauty_seller_candidates" on public.beauty_seller_candidates;

revoke all on table public.beauty_seller_candidates from anon;
revoke all on table public.beauty_seller_candidates from authenticated;
revoke all on sequence public.beauty_seller_candidates_id_seq from anon;
revoke all on sequence public.beauty_seller_candidates_id_seq from authenticated;

grant usage on schema public to service_role;
grant all on table public.beauty_seller_candidates to service_role;
grant all on sequence public.beauty_seller_candidates_id_seq to service_role;
