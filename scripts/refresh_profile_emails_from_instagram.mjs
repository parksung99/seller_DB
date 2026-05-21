import { readSupabaseEnv } from "./supabase_env.mjs";

const TABLE = "beauty_seller_candidates";
const WEB_PROFILE_ENDPOINT = "https://i.instagram.com/api/v1/users/web_profile_info/";
const DEFAULT_LIMIT = 10000;
const DEFAULT_DELAY_MS = 1200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    limit: DEFAULT_LIMIT,
    delayMs: DEFAULT_DELAY_MS,
    onlyMissing: false,
    assignee: "",
    cookie: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") args.limit = Number(argv[++i]) || args.limit;
    else if (arg === "--delay-ms") args.delayMs = Number(argv[++i]) || args.delayMs;
    else if (arg === "--only-missing") args.onlyMissing = true;
    else if (arg === "--assignee") args.assignee = String(argv[++i] || "").trim();
    else if (arg === "--cookie") args.cookie = argv[++i] || "";
  }

  return args;
}

function supabaseHeaders(env, extra = {}) {
  return {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
    ...extra,
  };
}

function getCookieValue(cookie, name) {
  const match = String(cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function instagramWebHeaders(cookie, referer = "https://www.instagram.com/") {
  return {
    accept: "application/json,text/plain,*/*",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    pragma: "no-cache",
    referer,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "x-csrftoken": getCookieValue(cookie, "csrftoken"),
    "x-ig-app-id": "936619743392459",
    "x-requested-with": "XMLHttpRequest",
    cookie,
  };
}

function normalizeHandle(value) {
  const raw = String(value || "").trim().replace(/^@/, "").replace(/\/+$/, "");
  if (!raw) return "";
  const match = raw.match(/instagram\.com\/(?!p\/|reel\/|tv\/|explore\/|accounts\/)([A-Za-z0-9._]+)/i);
  return (match ? match[1] : raw).trim().replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
}

function handleFromRow(row) {
  return normalizeHandle(row.seller_id || row.profile_url || row.seller_name || "");
}

function extractEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function extractProfileImage(user) {
  return (
    user?.profile_pic_url_hd ||
    user?.hd_profile_pic_url_info?.url ||
    user?.profile_pic_url ||
    user?.profile_picture ||
    user?.profile_picture_url ||
    ""
  );
}

async function fetchCandidates(env, args) {
  const params = new URLSearchParams();
  params.set("select", "id,seller_name,seller_id,profile_url,profile_email,profile_image_url,assignee,review_status");
  params.set("order", "id.asc");
  params.set("limit", String(args.limit));
  if (args.assignee) params.set("assignee", `eq.${args.assignee}`);
  if (args.onlyMissing) params.set("or", "(profile_email.is.null,profile_email.eq.)");

  const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?${params.toString()}`, {
    headers: supabaseHeaders(env, { accept: "application/json" }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`candidate fetch failed ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

async function fetchProfile(username, cookie) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${WEB_PROFILE_ENDPOINT}?username=${encodeURIComponent(username)}`, {
      signal: controller.signal,
      headers: instagramWebHeaders(cookie, `https://www.instagram.com/${username}/`),
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, email: "", profileImageUrl: "" };
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, status: response.status, email: "", profileImageUrl: "" };
    }
    const user = json?.data?.user || json?.user || json?.graphql?.user || {};
    return {
      ok: true,
      status: response.status,
      email:
        user.business_email ||
        user.public_email ||
        user.email ||
        extractEmail(`${user.biography || ""} ${user.bio || ""} ${user.full_name || ""} ${text}`),
      profileImageUrl: extractProfileImage(user),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function patchCandidate(env, id, payload) {
  if (!Object.keys(payload).length) return null;
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: supabaseHeaders(env, {
      "content-type": "application/json",
      prefer: "return=minimal",
    }),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`candidate patch failed id=${id} ${response.status}: ${text}`);
  return null;
}

async function main() {
  const env = readSupabaseEnv();
  const args = parseArgs(process.argv.slice(2));
  const cookie = args.cookie || env.instagramCookie || "";
  if (!env.supabaseUrl || !env.serviceRoleKey) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  if (!cookie) throw new Error("IG_COOKIE is required in .env, ig_cookie.txt, env, or --cookie.");

  const rows = await fetchCandidates(env, args);
  console.log(`[profile-email] target candidates: ${rows.length}`);
  let checked = 0;
  let updatedEmail = 0;
  let updatedImage = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const username = handleFromRow(row);
    if (!username) {
      skipped += 1;
      continue;
    }
    try {
      const profile = await fetchProfile(username, cookie);
      checked += 1;
      const payload = {};
      if (profile.email) payload.profile_email = profile.email;
      if (profile.profileImageUrl && !row.profile_image_url) payload.profile_image_url = profile.profileImageUrl;
      if (Object.keys(payload).length) {
        await patchCandidate(env, row.id, payload);
        if (payload.profile_email) updatedEmail += 1;
        if (payload.profile_image_url) updatedImage += 1;
        console.log(`[profile-email] update @${username}: ${payload.profile_email || "image only"}`);
      } else {
        console.log(`[profile-email] no email @${username}`);
      }
    } catch (error) {
      failed += 1;
      console.log(`[profile-email] fail @${username}: ${error.message}`);
    }
    if (args.delayMs) await sleep(args.delayMs);
  }

  console.log(`[done] checked=${checked} email_updated=${updatedEmail} image_updated=${updatedImage} skipped=${skipped} failed=${failed}`);
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
