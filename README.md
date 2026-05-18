# seller_DB

Team DM Manager for crawled Instagram seller candidates.

## What is included

- `index.html`: team review and DM status page
- `api/`: Vercel serverless API routes
- `scripts/review_api.mjs`: shared Supabase API logic
- `scripts/review_server.mjs`: local development server
- `scripts/import_candidates_to_supabase.mjs`: CSV import script
- `supabase_schema.sql`: Supabase table schema
- `SUPABASE_REVIEW_APP.md`: setup and deployment guide

Sensitive local files such as `.env`, `ig_cookie.txt`, `.tools/`, and `data/*.csv` are excluded by `.gitignore`.

## Local run

```powershell
.\.tools\node-v22.22.3-win-x64\node.exe scripts\review_server.mjs
```

Open `http://localhost:4317`.

## Vercel environment variables

```text
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your Supabase service_role key
TEAM_ACCESS_CODE=your shared team access code
```
