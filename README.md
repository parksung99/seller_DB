# seller_DB

Team DM and email manager for crawled Instagram seller candidates.

## What is included

- `index.html`: team review, assignment, DM, and email status dashboard
- Campaign email sender: campaign recipients, template variables, Gmail sending, reply sync, and message history
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
GMAIL_CLIENT_ID=your Gmail OAuth client id
GMAIL_CLIENT_SECRET=your Gmail OAuth client secret
GMAIL_REFRESH_TOKEN=your Gmail OAuth refresh token
GMAIL_SENDER_EMAIL=sender@example.com
GMAIL_SENDER_NAME=Sender Name
```

Run `supabase_schema.sql` in Supabase SQL Editor before using the campaign sender. The local setup script can apply it only when a valid Supabase Management API access token is configured.
