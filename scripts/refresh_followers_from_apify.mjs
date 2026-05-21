import fs from "node:fs";
import { readSupabaseEnv } from "./supabase_env.mjs";

const TABLE = "beauty_seller_candidates";
const DEFAULT_ACTOR = "apify/instagram-followers-count-scraper";

function parseArgs(argv) {
  const args = {
    actor: process.env.APIFY_ACTOR || DEFAULT_ACTOR,
    token: process.env.APIFY_TOKEN || "",
    limit: 100,
    batchSize: 50,
    dryRun: false,
    onlyMissingFollowers: true,
    inputField: process.env.APIFY_INPUT_FIELD || "usernames",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--actor") args.actor = String(argv[++i] || args.actor);
    else if (arg === "--token") args.token = String(argv[++i] || "");
    else if (arg === "--limit") args.limit = Number(argv[++i]) || args.limit;
    else if (arg === "--batch-size") args.batchSize = Number(argv[++i]) || args.batchSize;
    else if (arg === "--input-field") args.inputField = String(argv[++i] || args.inputField);
    else if (arg === "--all") args.onlyMissingFollowers = false;
    else if (arg === "--dry-run") args.dryRun = true;
  }

  return args;
}

function readDotEnvValue(name) {
  if (!fs.existsSync(".env")) return "";
  const text = fs.readFileSync(".env", "utf8");
  const line = text.split(/\r?\n/).find((item) => item.trim().startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : "";
}

function normalizeHandle(value) {
  const raw = String(value || "").trim().replace(/^@/, "").replace(/\/+$/, "");
  if (!raw) return "";
  const match = raw.match(/instagram\.com\/(?!p\/|reel\/|tv\/|explore\/|accounts\/)([A-Za-z0-9._]+)/i);
  return (match ? match[1] : raw).replace(/[/?#].*$/, "").toLowerCase();
}

function handleFromRow(row) {
  return normalizeHandle(row.seller_id || row.profile_url || row.seller_name || "");
}

function toNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function pickFollowerCount(item) {
  return toNumber(
    item.followersCount ??
      item.followers_count ??
      item.follower_count ??
      item.followers ??
      item.edge_followed_by?.count
  );
}

function pickUsername(item) {
  return normalizeHandle(
    item.userName ??
      item.username ??
      item.input ??
      item.url ??
      item.userUrl ??
      item.profileUrl ??
      item.profile_url
  );
}

function headers(env, extra = {}) {
  return {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
    ...extra,
  };
}

async function supabaseJson(env, path, options = {}) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: headers(env, options.headers || {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function fetchTargets(env, args) {
  const params = new URLSearchParams();
  params.set("select", "id,seller_name,seller_id,profile_url,follower_count");
  params.set("order", "id.asc");
  params.set("limit", String(args.limit));
  if (args.onlyMissingFollowers) {
    params.set("or", "(follower_count.is.null,follower_count.eq.0)");
  }
  const rows = await supabaseJson(env, `${TABLE}?${params}`, { headers: { accept: "application/json" } });
  const seen = new Set();
  return (rows || []).filter((row) => {
    const handle = handleFromRow(row);
    if (!handle || seen.has(handle)) return false;
    seen.add(handle);
    row.__handle = handle;
    return true;
  });
}

async function runActor(args, handles) {
  const actorId = encodeURIComponent(args.actor);
  const input = {
    [args.inputField]: handles,
  };
  const response = await fetch(`https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(args.token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Apify actor failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) : [];
}

async function patchFollower(env, row, followerCount) {
  await supabaseJson(env, `${TABLE}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      follower_count: followerCount,
      engagement_refresh_error: null,
      last_engagement_refresh_at: new Date().toISOString(),
    }),
  });
}

function chunks(items, size) {
  const list = [];
  for (let i = 0; i < items.length; i += size) list.push(items.slice(i, i + size));
  return list;
}

async function main() {
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const args = parseArgs(process.argv.slice(2));
  if (!args.token) args.token = readDotEnvValue("APIFY_TOKEN");
  if (!args.token) {
    throw new Error("APIFY_TOKEN is required in .env or --token.");
  }

  const targets = await fetchTargets(env, args);
  console.log(`[apify] targets=${targets.length} actor=${args.actor} input_field=${args.inputField}`);
  if (args.dryRun) {
    console.log(`[apify] dry-run handles=${targets.map((row) => row.__handle).slice(0, 50).join(", ")}`);
    return;
  }

  let updated = 0;
  let missing = 0;
  for (const batch of chunks(targets, args.batchSize)) {
    const handles = batch.map((row) => row.__handle);
    console.log(`[apify] run handles=${handles.length} first=@${handles[0]}`);
    const items = await runActor(args, handles);
    const byHandle = new Map();
    for (const item of items) {
      const handle = pickUsername(item);
      if (handle) byHandle.set(handle, item);
    }

    for (const row of batch) {
      const item = byHandle.get(row.__handle);
      const followerCount = item ? pickFollowerCount(item) : 0;
      if (!followerCount) {
        missing += 1;
        console.log(`[apify] missing @${row.__handle}`);
        continue;
      }
      await patchFollower(env, row, followerCount);
      updated += 1;
      console.log(`[apify] updated @${row.__handle}: ${followerCount}`);
    }
  }

  console.log(`[apify] done updated=${updated} missing=${missing}`);
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
