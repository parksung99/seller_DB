alter table public.beauty_seller_candidates disable row level security;

grant usage on schema public to anon;
grant usage on schema public to authenticated;

grant all privileges on table public.beauty_seller_candidates to anon;
grant all privileges on table public.beauty_seller_candidates to authenticated;
grant all privileges on table public.beauty_seller_candidates to service_role;

grant all privileges on sequence public.beauty_seller_candidates_id_seq to anon;
grant all privileges on sequence public.beauty_seller_candidates_id_seq to authenticated;
grant all privileges on sequence public.beauty_seller_candidates_id_seq to service_role;
