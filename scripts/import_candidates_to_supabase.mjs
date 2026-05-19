import fs from "node:fs/promises";
import path from "node:path";
import { readSupabaseEnv } from "./supabase_env.mjs";

const TABLE = "beauty_seller_candidates";

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function normalizeHandleFromUrl(profileUrl) {
  const match = /instagram\.com\/([^/?#]+)/i.exec(String(profileUrl || ""));
  return match ? match[1].trim().toLowerCase() : "";
}

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

async function purgeDuplicateSellerIds(env) {
  const fetchResponse = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?select=id,seller_id,updated_at`, {
    headers: {
      "apikey": env.serviceRoleKey,
      "authorization": `Bearer ${env.serviceRoleKey}`,
      accept: "application/json",
    },
  });
  const raw = await fetchResponse.text();
  if (!fetchResponse.ok) {
    throw new Error(`Failed to load candidates for dedupe: ${fetchResponse.status}: ${raw}`);
  }
  const rows = raw ? JSON.parse(raw) : [];

  const sorted = [...rows].sort((a, b) => {
    const aUpdated = Date.parse(a.updated_at || 0) || 0;
    const bUpdated = Date.parse(b.updated_at || 0) || 0;
    if (aUpdated === bUpdated) return Number(b.id) - Number(a.id);
    return bUpdated - aUpdated;
  });

  const keep = new Map();
  const duplicates = [];
  for (const row of sorted) {
    const sellerId = String(row.seller_id || "").trim().toLowerCase();
    if (!sellerId) continue;
    if (keep.has(sellerId)) duplicates.push(row.id);
    else keep.set(sellerId, row.id);
  }

  if (!duplicates.length) {
    console.log("[import] duplicate seller_id rows not found.");
    return;
  }
  console.log(`[import] duplicate seller_id rows: ${duplicates.length}`);

  for (let i = 0; i < duplicates.length; i += 120) {
    const batch = duplicates.slice(i, i + 120).map((id) => Number(id));
    const delRes = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?id=in.(${batch.join(",")})`, {
      method: "DELETE",
      headers: {
        "apikey": env.serviceRoleKey,
        "authorization": `Bearer ${env.serviceRoleKey}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
    });
    const delText = await delRes.text();
    if (!delRes.ok) {
      throw new Error(`Duplicate delete failed (${delRes.status}): ${delText}`);
    }
  }
}

function normalizeSellerId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^@/, "");
  if (!normalized) return "";
  if (normalized.includes("instagram.com/")) return normalizeHandleFromUrl(normalized);
  return normalized;
}

function resolveSellerName(row, sellerId) {
  const directName = String(row.seller_name || "").trim();
  if (directName) return directName;
  if (sellerId) return sellerId;
  const fromUrl = normalizeHandleFromUrl(row.profile_url);
  return fromUrl;
}

function removeDuplicateSellerIds(rows) {
  const deduped = [];
  const seen = new Set();
  const nameSeen = new Set();
  const removed = [];

  for (const row of rows) {
    const sellerKey = row.seller_id || "";
    const normalizedName = row.seller_name.trim().toLowerCase();
    if (sellerKey) {
      if (seen.has(sellerKey.toLowerCase())) {
        removed.push(row.seller_name);
        continue;
      }
      seen.add(sellerKey.toLowerCase());
    } else if (normalizedName && nameSeen.has(normalizedName)) {
      removed.push(row.seller_name);
      continue;
    } else if (normalizedName) {
      nameSeen.add(normalizedName);
    }

    deduped.push(row);
  }

  if (removed.length) {
    console.log(`[import] duplicate rows removed: ${removed.length}`, removed.slice(0, 20));
  }

  return deduped;
}

function mapRow(row, sourceFile) {
  const sellerId = normalizeSellerId(row.seller_id || row.id || row.instagram_id || row.instagramUserId || "");
  return {
    seller_name: resolveSellerName(row, sellerId),
    seller_id: sellerId,
    channel: row.channel || "instagram",
    profile_url: row.profile_url || (sellerId ? `https://www.instagram.com/${sellerId}/` : ""),
    grade: row.grade,
    matched_hashtags_count: toInteger(row.matched_hashtags_count),
    matched_hashtags: row.matched_hashtags,
    category: row.category,
    beauty_score: toInteger(row.beauty_score),
    selling_score: toInteger(row.selling_score),
    negative_score: toInteger(row.negative_score),
    combination_score: toInteger(row.combination_score),
    combination_grades: row.combination_grades,
    total_likes: toInteger(row.total_likes),
    total_comments: toInteger(row.total_comments),
    avg_likes: toInteger(row.avg_likes),
    avg_comments: toInteger(row.avg_comments),
    matched_beauty_keywords: row.matched_beauty_keywords,
    matched_selling_keywords: row.matched_selling_keywords,
    negative_keywords: row.negative_keywords,
    follower_count: toInteger(row.follower_count),
    beauty_anchor_tags: row.beauty_anchor_tags,
    commercial_signal_tags: row.commercial_signal_tags,
    format_signal_tags: row.format_signal_tags,
    dm_available: row.dm_available,
    sample_post_urls: row.sample_post_urls,
    notes: row.notes,
    source_file: sourceFile,
  };
}

function parseConflictError(text) {
  return /on_conflict|conflict/i.test(text || "");
}

async function upsertBatch(env, rows) {
  const payload = JSON.stringify(rows);
  const headers = {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
    "content-type": "application/json",
    prefer: "resolution=merge-duplicates,return=minimal",
  };

  const candidates = [
    "seller_id",
    "seller_name",
  ];

  let lastError = "";
  for (const conflictTarget of candidates) {
    const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?on_conflict=${encodeURIComponent(conflictTarget)}`, {
      method: "POST",
      headers,
      body: payload,
    });

    const text = await response.text();
    if (response.ok) return;

    lastError = `Supabase upsert failed (${response.status}, on_conflict=${conflictTarget}): ${text}`;
    if (parseConflictError(text)) {
      continue;
    }
    throw new Error(lastError);
  }

  throw new Error(lastError);
}

async function main() {
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  }
  console.log(`[import] target: ${env.supabaseUrl}/rest/v1/${TABLE}`);

  const csvPath =
    process.argv[2] ||
    "data/instagram_beauty_seller_summary_2026-05-18T11-34-28-209Z.csv";
  const text = await fs.readFile(csvPath, "utf8");
  const sourceFile = path.basename(csvPath);
  const rows = parseCsv(text)
    .map((row) => mapRow(row, sourceFile))
    .filter((row) => row.seller_name);
  const dedupedRows = removeDuplicateSellerIds(rows);
  console.log(`[import] source: ${csvPath} (${rows.length} rows)`);
  console.log(`[import] deduped rows: ${dedupedRows.length} rows`);

  const batchSize = 100;
  for (let index = 0; index < dedupedRows.length; index += batchSize) {
    const batch = dedupedRows.slice(index, index + batchSize);
    await upsertBatch(env, batch);
    console.log(`[import] ${Math.min(index + batch.length, dedupedRows.length)} / ${dedupedRows.length}`);
  }

  await purgeDuplicateSellerIds(env);

  console.log(`[done] imported candidates: ${dedupedRows.length}. Existing review/DM status and memo were preserved.`);
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
