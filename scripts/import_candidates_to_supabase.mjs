import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readSupabaseEnv } from "./supabase_env.mjs";

const TABLE = "beauty_seller_candidates";
const EXCLUDED_TABLE = "excluded_instagram_handles";

function parseArgs(argv) {
  const args = {
    csvPath: "",
    skipExistingDb: false,
    skipAssign: false,
  };

  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--skip-existing-db") args.skipExistingDb = true;
    else if (arg === "--skip-assign") args.skipAssign = true;
    else if (arg.startsWith("--")) console.log(`[warn] unknown option: ${arg}`);
    else rest.push(arg);
  }

  args.csvPath = rest[0] || "";
  return args;
}

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

function normalizeHandle(value) {
  const raw = String(value || "").trim().replace(/^@/, "").replace(/\/+$/, "");
  if (!raw) return "";
  if (raw.includes("instagram.com/")) return normalizeHandleFromUrl(raw);
  return raw.toLowerCase();
}

function handlesFromCandidate(row) {
  return [
    normalizeHandle(row.seller_id),
    normalizeHandle(row.seller_name),
    normalizeHandle(row.profile_url),
  ].filter(Boolean);
}

function handleFromMappedRow(row) {
  return normalizeHandle(row.seller_id || row.profile_url || row.seller_name);
}

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function runAssignment() {
  const scriptPath = path.join(process.cwd(), "scripts", "assign_candidates.mjs");
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`assign failed (code ${result.status})`);
  }
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

async function fetchExcludedHandles(env) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${EXCLUDED_TABLE}?select=handle&limit=10000`, {
    headers: {
      "apikey": env.serviceRoleKey,
      "authorization": `Bearer ${env.serviceRoleKey}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  if (response.ok) {
    return new Set((text ? JSON.parse(text) : []).map((row) => normalizeHandle(row.handle)).filter(Boolean));
  }
  if (response.status === 404) {
    console.log("[import] excluded_instagram_handles table not found. Falling back to candidate review_status=제외.");
    return fetchCandidateExcludedHandles(env);
  }
  throw new Error(`Failed to load excluded handles: ${response.status}: ${text}`);
}

async function fetchCandidateExcludedHandles(env) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?select=seller_id,seller_name,profile_url&review_status=eq.%EC%A0%9C%EC%99%B8&limit=10000`, {
    headers: {
      "apikey": env.serviceRoleKey,
      "authorization": `Bearer ${env.serviceRoleKey}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to load candidate exclusions: ${response.status}: ${text}`);
  }
  return new Set((text ? JSON.parse(text) : []).flatMap(handlesFromCandidate));
}

async function fetchExistingCandidateHandles(env) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?select=seller_id,seller_name,profile_url&limit=10000`, {
    headers: {
      "apikey": env.serviceRoleKey,
      "authorization": `Bearer ${env.serviceRoleKey}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  if (response.ok) {
    return new Set((text ? JSON.parse(text) : []).flatMap(handlesFromCandidate));
  }
  if (response.status === 404) return new Set();
  throw new Error(`Failed to load existing candidates: ${response.status}: ${text}`);
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
  const sellerId = normalizeSellerId(
    row.seller_id || row.id || row.instagram_id || row.instagramUserId || normalizeHandleFromUrl(row.profile_url) || ""
  );
  const prospectNote = buildProspectNote(row);
  return {
    seller_name: resolveSellerName(row, sellerId),
    seller_id: sellerId,
    channel: row.channel || "instagram",
    profile_url: row.profile_url || (sellerId ? `https://www.instagram.com/${sellerId}/` : ""),
    profile_email: row.profile_email || row.email || row.public_email || "",
    profile_image_url: row.profile_image_url || row.profile_pic_url || row.profile_picture_url || "",
    grade: row.grade,
    matched_hashtags_count: toInteger(row.matched_hashtags_count),
    matched_hashtags: row.matched_hashtags,
    category: row.category,
    beauty_score: toInteger(row.beauty_score),
    selling_score: toInteger(row.selling_score),
    negative_score: toInteger(row.negative_score),
    combination_score: toInteger(row.combination_score),
    combination_grades: row.combination_grades,
    prospect_score: toInteger(row.prospect_score),
    prospect_noise_score: toInteger(row.prospect_noise_score),
    prospect_personas: row.prospect_personas,
    prospect_signal_tags: row.prospect_signal_tags,
    matched_prospect_keywords: row.matched_prospect_keywords,
    prospect_noise_keywords: row.prospect_noise_keywords,
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
    email_status: row.email_status || "미발송",
    sample_post_urls: row.sample_post_urls,
    notes: [prospectNote, row.notes].filter(Boolean).join("\n"),
    source_file: sourceFile,
  };
}

function buildProspectNote(row) {
  const parts = [
    row.prospect_score ? `욕망점수:${row.prospect_score}` : "",
    row.prospect_personas ? `페르소나:${row.prospect_personas}` : "",
    row.prospect_signal_tags ? `욕망태그:${row.prospect_signal_tags}` : "",
    row.matched_prospect_keywords ? `욕망키워드:${row.matched_prospect_keywords}` : "",
  ].filter(Boolean);
  return parts.length ? `[prospect] ${parts.join(" / ")}` : "";
}

function parseConflictError(text) {
  return /on_conflict|conflict/i.test(text || "");
}

function parseMissingColumn(text) {
  return String(text || "").match(/Could not find the '([^']+)' column/i)?.[1] || "";
}

function removeColumnFromRows(rows, column) {
  return rows.map((row) => {
    const next = { ...row };
    delete next[column];
    return next;
  });
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
    const missingColumn = parseMissingColumn(text);
    if (missingColumn) {
      console.log(`[import] column not found in DB, retrying without: ${missingColumn}`);
      return upsertBatch(env, removeColumnFromRows(rows, missingColumn));
    }
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

  const args = parseArgs(process.argv.slice(2));
  const csvPath =
    args.csvPath ||
    "data/instagram_beauty_seller_summary_2026-05-18T11-34-28-209Z.csv";
  const text = await fs.readFile(csvPath, "utf8");
  const sourceFile = path.basename(csvPath);
  const rows = parseCsv(text)
    .map((row) => mapRow(row, sourceFile))
    .filter((row) => row.seller_name);
  const excludedHandles = await fetchExcludedHandles(env);
  const afterExcludedRows = excludedHandles.size
    ? rows.filter((row) => !excludedHandles.has(normalizeHandle(row.seller_id || row.profile_url || row.seller_name)))
    : rows;
  const existingHandles = args.skipExistingDb ? await fetchExistingCandidateHandles(env) : new Set();
  if (args.skipExistingDb) console.log(`[import] existing DB handles loaded: ${existingHandles.size}`);
  const filteredRows = existingHandles.size
    ? afterExcludedRows.filter((row) => !existingHandles.has(handleFromMappedRow(row)))
    : afterExcludedRows;
  const dedupedRows = removeDuplicateSellerIds(filteredRows);
  const excludedSkipped = rows.length - afterExcludedRows.length;
  const existingSkipped = afterExcludedRows.length - filteredRows.length;
  console.log(`[import] source: ${csvPath} (${rows.length} rows)`);
  console.log(`[import] excluded rows skipped: ${excludedSkipped}`);
  console.log(`[import] existing DB rows skipped: ${existingSkipped}`);
  console.log(`[import] deduped rows: ${dedupedRows.length} rows`);

  const batchSize = 100;
  for (let index = 0; index < dedupedRows.length; index += batchSize) {
    const batch = dedupedRows.slice(index, index + batchSize);
    await upsertBatch(env, batch);
    console.log(`[import] ${Math.min(index + batch.length, dedupedRows.length)} / ${dedupedRows.length}`);
  }

  await purgeDuplicateSellerIds(env);

  console.log(`[done] imported candidates: ${dedupedRows.length}. Existing review/DM status and memo were preserved.`);

  if (!args.skipAssign) {
    console.log("[import] assigning unassigned candidates.");
    runAssignment();
  }
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
