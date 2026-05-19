import { readSupabaseEnv } from "./supabase_env.mjs";

const TABLE = "beauty_seller_candidates";
const SELECT_LIMIT = 20000;

function buildHeaders(env) {
  return {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
  };
}

async function fetchAllWithSellerId(env) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?select=id,seller_id,updated_at`, {
    headers: {
      ...buildHeaders(env),
      accept: "application/json",
      range: `0-${SELECT_LIMIT - 1}`,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

async function deleteRows(env, ids) {
  if (!ids.length) return;
  const url = `${env.supabaseUrl}/rest/v1/${TABLE}?id=in.(${ids.join(",")})`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      ...buildHeaders(env),
      prefer: "return=minimal",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
}

async function main() {
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const rows = await fetchAllWithSellerId(env);
  const sorted = [...rows].sort((a, b) => {
    const aUpdated = Date.parse(a.updated_at || 0) || 0;
    const bUpdated = Date.parse(b.updated_at || 0) || 0;
    if (aUpdated === bUpdated) return Number(b.id) - Number(a.id);
    return bUpdated - aUpdated;
  });

  const keep = new Map();
  const duplicateIds = [];
  for (const row of sorted) {
    const sellerId = String(row.seller_id || "").trim().toLowerCase();
    if (!sellerId) continue;
    if (keep.has(sellerId)) duplicateIds.push(row.id);
    else keep.set(sellerId, row.id);
  }

  if (!duplicateIds.length) {
    console.log("[dedupe] duplicates not found.");
    return;
  }
  console.log(`[dedupe] duplicate rows: ${duplicateIds.length}`);
  for (let index = 0; index < duplicateIds.length; index += 150) {
    const batch = duplicateIds.slice(index, index + 150).map((id) => Number(id));
    await deleteRows(env, batch);
    console.log(`[dedupe] deleted ${Math.min(index + batch.length, duplicateIds.length)} / ${duplicateIds.length}`);
  }
  console.log("[dedupe] done.");
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
