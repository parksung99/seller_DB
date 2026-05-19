import { readSupabaseEnv } from "./supabase_env.mjs";

const TABLE = "beauty_seller_candidates";
const env = readSupabaseEnv();

if (!env.supabaseUrl || !env.serviceRoleKey) {
  throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
}

const payload = {
  seller_name: "bbabseung",
  profile_url: "https://www.instagram.com/bbabseung/",
  channel: "instagram",
};

const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?on_conflict=seller_name`, {
  method: "POST",
  headers: {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
    "content-type": "application/json",
    prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify([payload]),
});

const text = await response.text();
if (!response.ok) {
  throw new Error(`${response.status}: ${text}`);
}

console.log("ok");
