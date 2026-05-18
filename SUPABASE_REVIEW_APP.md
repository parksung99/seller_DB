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

## 2. Import CSV

Default import:

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\import_candidates_to_supabase.mjs
```

Import another CSV:

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\import_candidates_to_supabase.mjs data\your-file.csv
```

Rows are upserted by `seller_name`. Crawled fields are refreshed, while team workflow fields such as `review_status`, `dm_status`, `brand_fit`, `assignee`, and `memo` are preserved.

## 3. Run Locally

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\review_server.mjs
```

Open:

```text
http://localhost:4317
```

If `TEAM_ACCESS_CODE` is present in `.env` or environment variables, local API calls require that code. If it is absent, local testing works without a code.

## 4. Deploy to Vercel

Set these Vercel environment variables:

```text
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your Supabase service_role key
TEAM_ACCESS_CODE=your shared team access code
```

Important: `SUPABASE_SERVICE_ROLE_KEY` is used only inside server API routes. It is not embedded in `index.html`.

## Features

- Search by seller name, hashtags, and memo
- Filter by grade, review status, DM status, and assignee
- Open Instagram profile and sample post URLs
- Save review status, DM status, brand fit, assignee, and team memo
- Show last updater and last update time
- Automatically records contact time when DM status is saved as sent or replied
