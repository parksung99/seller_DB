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

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function mapRow(row, sourceFile) {
  return {
    seller_name: row.seller_name,
    channel: row.channel || "instagram",
    profile_url: row.profile_url,
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
    matched_beauty_keywords: row.matched_beauty_keywords,
    matched_selling_keywords: row.matched_selling_keywords,
    negative_keywords: row.negative_keywords,
    beauty_anchor_tags: row.beauty_anchor_tags,
    commercial_signal_tags: row.commercial_signal_tags,
    format_signal_tags: row.format_signal_tags,
    dm_available: row.dm_available,
    sample_post_urls: row.sample_post_urls,
    notes: row.notes,
    source_file: sourceFile,
  };
}

async function upsertBatch(env, rows) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?on_conflict=seller_name`, {
    method: "POST",
    headers: {
      "apikey": env.serviceRoleKey,
      "authorization": `Bearer ${env.serviceRoleKey}`,
      "content-type": "application/json",
      "prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase upsert failed (${response.status}): ${text}`);
  }
}

async function main() {
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const csvPath =
    process.argv[2] ||
    "data/instagram_beauty_seller_summary_2026-05-18T11-34-28-209Z.csv";
  const text = await fs.readFile(csvPath, "utf8");
  const sourceFile = path.basename(csvPath);
  const rows = parseCsv(text)
    .map((row) => mapRow(row, sourceFile))
    .filter((row) => row.seller_name);

  const batchSize = 100;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    await upsertBatch(env, batch);
    console.log(`[import] ${Math.min(index + batch.length, rows.length)} / ${rows.length}`);
  }

  console.log(`[done] imported candidates: ${rows.length}. Existing review/DM status and memo were preserved.`);
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
