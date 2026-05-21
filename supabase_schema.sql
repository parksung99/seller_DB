create table if not exists public.beauty_seller_candidates (
  id bigserial primary key,
  seller_name text not null,
  seller_id text,
  channel text default 'instagram',
  profile_url text,
  profile_email text,
  profile_image_url text,
  grade text,
  matched_hashtags_count integer default 0,
  matched_hashtags text,
  category text,
  beauty_score integer default 0,
  selling_score integer default 0,
  negative_score integer default 0,
  combination_score integer default 0,
  combination_grades text,
  prospect_score integer default 0,
  prospect_noise_score integer default 0,
  prospect_personas text,
  prospect_signal_tags text,
  matched_prospect_keywords text,
  prospect_noise_keywords text,
  total_likes integer default 0,
  total_comments integer default 0,
  avg_likes integer default 0,
  avg_comments integer default 0,
  follower_count integer default 0,
  matched_beauty_keywords text,
  matched_selling_keywords text,
  negative_keywords text,
  beauty_anchor_tags text,
  commercial_signal_tags text,
  format_signal_tags text,
  dm_available text,
  sample_post_urls text,
  notes text,
  engagement_rate numeric(10, 4),
  engagement_post_count integer default 0,
  engagement_posts text,
  last_engagement_refresh_at timestamptz,
  engagement_refresh_error text,
  review_status text default U&'\BBF8\D655\C778',
  dm_status text default U&'\BBF8\BC1C\C1A1',
  email_status text default U&'\BBF8\BC1C\C1A1',
  brand_fit text,
  groupbuy_experience text default U&'\BD88\BA85',
  agency_status text default U&'\BD88\BA85',
  assignee text,
  memo text,
  status_updated_by text,
  status_updated_at timestamptz,
  last_contacted_at timestamptz,
  last_emailed_at timestamptz,
  last_replied_at timestamptz,
  source_file text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (seller_name)
);

alter table public.beauty_seller_candidates
  add column if not exists assignee text,
  add column if not exists status_updated_by text,
  add column if not exists status_updated_at timestamptz,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists email_status text default U&'\BBF8\BC1C\C1A1',
  add column if not exists last_emailed_at timestamptz,
  add column if not exists last_replied_at timestamptz,
  add column if not exists seller_id text,
  add column if not exists profile_email text,
  add column if not exists profile_image_url text,
  add column if not exists follower_count integer default 0,
  add column if not exists avg_likes integer default 0,
  add column if not exists avg_comments integer default 0,
  add column if not exists engagement_rate numeric(10, 4),
  add column if not exists engagement_post_count integer default 0,
  add column if not exists engagement_posts text,
  add column if not exists last_engagement_refresh_at timestamptz,
  add column if not exists engagement_refresh_error text,
  add column if not exists brand_fit text,
  add column if not exists groupbuy_experience text default U&'\BD88\BA85',
  add column if not exists agency_status text default U&'\BD88\BA85',
  add column if not exists memo text,
  add column if not exists prospect_score integer default 0,
  add column if not exists prospect_noise_score integer default 0,
  add column if not exists prospect_personas text,
  add column if not exists prospect_signal_tags text,
  add column if not exists matched_prospect_keywords text,
  add column if not exists prospect_noise_keywords text;

alter table public.beauty_seller_candidates
  alter column review_status set default U&'\BBF8\D655\C778',
  alter column dm_status set default U&'\BBF8\BC1C\C1A1',
  alter column email_status set default U&'\BBF8\BC1C\C1A1',
  alter column groupbuy_experience set default U&'\BD88\BA85',
  alter column agency_status set default U&'\BD88\BA85';

update public.beauty_seller_candidates
set review_status = U&'\BBF8\D655\C778'
where review_status is null or review_status in ('', 'DM');

update public.beauty_seller_candidates
set dm_status = U&'\BBF8\BC1C\C1A1'
where dm_status is null or dm_status in ('', 'DM');

update public.beauty_seller_candidates
set email_status = U&'\BBF8\BC1C\C1A1'
where email_status is null or email_status = '';

update public.beauty_seller_candidates
set groupbuy_experience = U&'\BD88\BA85'
where groupbuy_experience is null or groupbuy_experience = '';

update public.beauty_seller_candidates
set agency_status = U&'\BD88\BA85'
where agency_status is null or agency_status = '';

-- 중복 seller_id 정리(동일 seller_id가 2개 이상이면 가장 최신 행만 남김)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY seller_id
           ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
         ) AS rn
  FROM public.beauty_seller_candidates
  WHERE seller_id IS NOT NULL AND seller_id <> ''
)
DELETE FROM public.beauty_seller_candidates
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

create unique index if not exists ux_beauty_seller_candidates_seller_id
  on public.beauty_seller_candidates (seller_id)
  where seller_id is not null and seller_id <> '';

create index if not exists idx_beauty_seller_candidates_grade
  on public.beauty_seller_candidates (grade);

create index if not exists idx_beauty_seller_candidates_review_status
  on public.beauty_seller_candidates (review_status);

create index if not exists idx_beauty_seller_candidates_dm_status
  on public.beauty_seller_candidates (dm_status);

create index if not exists idx_beauty_seller_candidates_email_status
  on public.beauty_seller_candidates (email_status);

create index if not exists idx_beauty_seller_candidates_assignee
  on public.beauty_seller_candidates (assignee);

create index if not exists idx_beauty_seller_candidates_scores
  on public.beauty_seller_candidates (combination_score desc, beauty_score desc, selling_score desc);

create index if not exists idx_beauty_seller_candidates_prospect_score
  on public.beauty_seller_candidates (prospect_score desc);

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

create table if not exists public.outreach_campaigns (
  id bigserial primary key,
  name text not null,
  sender_email text,
  sender_name text,
  subject_template text default '',
  body_template text default '',
  schedule_template text default '',
  status text default 'draft',
  created_by text,
  last_sent_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.outreach_recipients (
  id bigserial primary key,
  campaign_id bigint not null references public.outreach_campaigns(id) on delete cascade,
  candidate_id bigint references public.beauty_seller_candidates(id) on delete set null,
  send_channel text default 'email',
  email text,
  account text,
  name text,
  profile_url text,
  profile_image_url text,
  personalized_subject text,
  personalized_body text,
  personalized_context jsonb default '{}'::jsonb,
  send_status text default 'pending',
  gmail_message_id text,
  gmail_thread_id text,
  error_message text,
  replied boolean default false,
  last_sent_at timestamptz,
  last_replied_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (campaign_id, candidate_id)
);

create table if not exists public.outreach_messages (
  id bigserial primary key,
  campaign_id bigint not null references public.outreach_campaigns(id) on delete cascade,
  recipient_id bigint references public.outreach_recipients(id) on delete cascade,
  candidate_id bigint references public.beauty_seller_candidates(id) on delete set null,
  direction text not null,
  subject text,
  body_snippet text,
  gmail_message_id text,
  gmail_thread_id text,
  message_at timestamptz,
  created_at timestamptz default now()
);

alter table public.outreach_campaigns
  add column if not exists sender_email text,
  add column if not exists sender_name text,
  add column if not exists subject_template text default '',
  add column if not exists body_template text default '',
  add column if not exists schedule_template text default '',
  add column if not exists status text default 'draft',
  add column if not exists created_by text,
  add column if not exists last_sent_at timestamptz,
  add column if not exists last_synced_at timestamptz;

alter table public.outreach_recipients
  add column if not exists send_channel text default 'email',
  add column if not exists email text,
  add column if not exists account text,
  add column if not exists name text,
  add column if not exists profile_url text,
  add column if not exists profile_image_url text,
  add column if not exists personalized_subject text,
  add column if not exists personalized_body text,
  add column if not exists personalized_context jsonb default '{}'::jsonb,
  add column if not exists send_status text default 'pending',
  add column if not exists gmail_message_id text,
  add column if not exists gmail_thread_id text,
  add column if not exists error_message text,
  add column if not exists replied boolean default false,
  add column if not exists last_sent_at timestamptz,
  add column if not exists last_replied_at timestamptz;

create index if not exists idx_outreach_campaigns_status
  on public.outreach_campaigns (status);

create index if not exists idx_outreach_recipients_campaign_id
  on public.outreach_recipients (campaign_id);

create index if not exists idx_outreach_recipients_send_status
  on public.outreach_recipients (send_status);

create index if not exists idx_outreach_recipients_gmail_thread_id
  on public.outreach_recipients (gmail_thread_id);

create index if not exists idx_outreach_messages_campaign_id
  on public.outreach_messages (campaign_id);

create index if not exists idx_outreach_messages_recipient_id
  on public.outreach_messages (recipient_id);

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

drop trigger if exists trg_outreach_campaigns_updated_at on public.outreach_campaigns;
create trigger trg_outreach_campaigns_updated_at
before update on public.outreach_campaigns
for each row execute function public.set_updated_at();

drop trigger if exists trg_outreach_recipients_updated_at on public.outreach_recipients;
create trigger trg_outreach_recipients_updated_at
before update on public.outreach_recipients
for each row execute function public.set_updated_at();
