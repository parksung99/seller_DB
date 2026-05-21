# Team DM Manager

This app uploads crawled Instagram seller candidates to Supabase and lets teammates share review and DM sending status from one page.

## 1. Prepare Supabase

Open Supabase Dashboard > SQL Editor and run `supabase_schema.sql`.

Table:

```text
public.beauty_seller_candidates
```

Team workflow columns:

```text
assignee
status_updated_by
status_updated_at
last_contacted_at
```

If you get `PGRST205` on the app, apply the migration above first and check:

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'beauty_seller_candidates';
```

## 2. Import CSV

Default import:

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\import_candidates_to_supabase.mjs
```

Import another CSV:

 ```powershell
 .\.tools\node-v22.22.3-win-x64\node.exe scripts\import_candidates_to_supabase.mjs data\your-file.csv
 ```

Rows are upserted by `seller_name` (when provided) and missing names are automatically filled from `seller_id` or profile URL, so CSV with only `id`/`seller_id` can still be imported.
Team workflow fields such as `review_status`, `dm_status`, `brand_fit`, `assignee`, and `memo` are preserved.
For id-only files, run this after import:

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\refresh_engagement_from_instagram.mjs --cookie "your_instagram_cookie" --max-posts 20 --limit 100
```
Or run both in one command:

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\import_then_refresh.mjs data\your-id-only-file.csv --cookie "your_instagram_cookie" --max-posts 20 --limit 100
```

npm also provides:

```powershell
npm run supabase:import:refresh -- data\your-id-only-file.csv --cookie "your_instagram_cookie" --max-posts 20 --limit 100
```
After import, duplicate `seller_id` rows are automatically removed (`updated_at` 최신 기준으로 보존).

If you only want to clean duplicates without import:

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\dedupe_seller_id_rows.mjs
```

## 3. Run Locally

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\review_server.mjs
```

Open:

```text
http://localhost:4317
```

Local API calls are available without a team access code.

## 4. Deploy to Vercel

Set these Vercel environment variables:

```text
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your Supabase service_role key
```

Important: `SUPABASE_SERVICE_ROLE_KEY` is used only inside server API routes. It is not embedded in `index.html`.

### Auto migration attempt

You can also try:

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\setup_supabase_table.mjs
```

This will succeed only if `SUPABASE_ACCESS_TOKEN` is available and valid for Supabase Management API.

## Features

- Search by seller name, hashtags, and memo
- Filter by grade, review status, DM status, email status, and assignee
- Open Instagram profile and sample post URLs
- Save review status, DM status, email status, brand fit, assignee, and team memo
- Show last updater and last update time
- Automatically records DM contact time when DM status is saved as sent or replied
- Separately tracks email sent, email replied, and no-reply follow-up status

Run `supabase_schema.sql` in the Supabase SQL Editor after pulling this version so existing tables receive `email_status`, `last_emailed_at`, and `last_replied_at`.

## Engagement refresh

Collect engagement from recent posts on a fixed interval to avoid heavy crawling:

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\refresh_engagement_from_instagram.mjs --limit 80 --max-posts 20 --interval-ms 8000 --cookie "your_instagram_cookie" --with-fallback
```

`--all` can be added to include entries without `seller_id`.

If `IG_COOKIE` is saved in `.env`, you can omit `--cookie`. The refresh stores `follower_count`, `avg_likes`, `avg_comments`, `engagement_rate`, and any row-level failure reason in `engagement_refresh_error`.

To refresh only candidates whose follower count is missing:

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\refresh_engagement_from_instagram.mjs --only-missing-followers --with-fallback
```

If the current Supabase table is missing engagement columns, run `supabase_add_engagement_columns.sql` in the Supabase SQL Editor first.

To prevent client/anon/authenticated users from reading any candidate rows, run `supabase_lockdown_rls.sql` in the Supabase SQL Editor. The server API still works through `SUPABASE_SERVICE_ROLE_KEY`.

## Auto assignment

CSV import automatically assigns every unassigned, unchecked candidate to 김시은 or 박민서. Manual exclusions remain tied to the assigned owner and appear in that owner's excluded tab. To run assignment manually:

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\assign_candidates.mjs --dry-run
.\.tools\node-v22.22.3-win-x64\node.exe scripts\assign_candidates.mjs
```

Existing `assignee` values are preserved and skipped by default. Follower ranges are used as a first preference, and rows outside those ranges are still balanced between 김시은 and 박민서 instead of being excluded. Use `--skip-assign` on import scripts only when assignment should be delayed.
