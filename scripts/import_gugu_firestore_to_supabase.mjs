import { readSupabaseEnv } from "./supabase_env.mjs";

const FIRESTORE_PROJECT_ID = "gugu-influencer-db-153f2";
const FIRESTORE_API_KEY = "AIzaSyCIGTOJTdUG1WPCYMmjgOU9KL23bnZDxxw";
const FIRESTORE_COLLECTION = "influencers";
const TABLE = "beauty_seller_candidates";

const ASSIGNEE = "김시은";
const REVIEW_UNCHECKED = "미확인";
const DM_UNSENT = "미발송";
const DM_SENT = "발송완료";
const LEGACY_DM_SENT = "DM발송";
const SOURCE_FILE = "gugu_firestore_influencers";

function hasFlag(name) {
  return process.argv.includes(name);
}

function fieldValue(field) {
  if (!field) return "";
  return field.stringValue ?? field.integerValue ?? field.doubleValue ?? field.timestampValue ?? "";
}

function normalizeHandle(value) {
  const raw = String(value || "").trim().replace(/^@/, "").replace(/\/+$/, "");
  if (!raw) return "";
  const match = raw.match(/instagram\.com\/(?!p\/|reel\/|tv\/|explore\/|accounts\/)([A-Za-z0-9._]+)/i);
  return (match ? match[1] : raw).trim().replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
}

function handleFromInstagramUrl(value) {
  return normalizeHandle(value);
}

function statusRank(status) {
  return status === LEGACY_DM_SENT ? 2 : 1;
}

function toLegacyRow(document) {
  const fields = document.fields || {};
  const handle = normalizeHandle(fieldValue(fields.handle)) || handleFromInstagramUrl(fieldValue(fields.instaUrl));
  if (!handle) return null;

  return {
    handle,
    legacyStatus: String(fieldValue(fields.status) || "").trim(),
    nickname: String(fieldValue(fields.nickname) || "").trim(),
    firestoreId: String(document.name || "").split("/").pop(),
  };
}

async function fetchFirestoreInfluencers() {
  let pageToken = "";
  const rows = [];
  let totalDocuments = 0;

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${FIRESTORE_COLLECTION}`
    );
    url.searchParams.set("pageSize", "300");
    url.searchParams.set("key", FIRESTORE_API_KEY);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url);
    const json = await response.json();
    if (!response.ok) {
      throw new Error(`Firestore fetch failed (${response.status}): ${JSON.stringify(json)}`);
    }

    const documents = json.documents || [];
    totalDocuments += documents.length;
    rows.push(...documents.map(toLegacyRow).filter(Boolean));
    pageToken = json.nextPageToken || "";
  } while (pageToken);

  return { totalDocuments, rows };
}

function dedupeRows(rows) {
  const byHandle = new Map();
  const duplicates = [];

  for (const row of rows) {
    const existing = byHandle.get(row.handle);
    if (!existing) {
      byHandle.set(row.handle, row);
      continue;
    }

    duplicates.push({ handle: row.handle, statuses: [existing.legacyStatus, row.legacyStatus].filter(Boolean) });
    if (statusRank(row.legacyStatus) > statusRank(existing.legacyStatus)) {
      byHandle.set(row.handle, row);
    }
  }

  return {
    rows: [...byHandle.values()].sort((a, b) => a.handle.localeCompare(b.handle)),
    duplicates,
  };
}

function toSupabasePatch(row, now) {
  const sent = row.legacyStatus === LEGACY_DM_SENT;
  return {
    seller_name: row.handle,
    seller_id: row.handle,
    channel: "instagram",
    profile_url: `https://www.instagram.com/${row.handle}/`,
    review_status: REVIEW_UNCHECKED,
    dm_status: sent ? DM_SENT : DM_UNSENT,
    assignee: ASSIGNEE,
    status_updated_by: ASSIGNEE,
    status_updated_at: now,
    last_contacted_at: sent ? now : null,
    source_file: SOURCE_FILE,
  };
}

function countBy(rows, getValue) {
  return rows.reduce((acc, row) => {
    const value = getValue(row) || "(empty)";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function printSummary({ totalDocuments, legacyRows, dedupedRows, duplicates, mode }) {
  const legacyStatusCounts = countBy(legacyRows, (row) => row.legacyStatus);
  const dmSent = dedupedRows.filter((row) => row.legacyStatus === LEGACY_DM_SENT).length;
  const unchecked = dedupedRows.length - dmSent;

  console.log(`[${mode}] Firestore documents: ${totalDocuments}`);
  console.log(`[${mode}] Firestore rows with handle: ${legacyRows.length}`);
  console.log(`[${mode}] unique handles: ${dedupedRows.length}`);
  console.log(`[${mode}] legacy status counts: ${JSON.stringify(legacyStatusCounts)}`);
  console.log(`[${mode}] will set dm_status=${DM_SENT}: ${dmSent}`);
  console.log(`[${mode}] will set dm_status=${DM_UNSENT}, review_status=${REVIEW_UNCHECKED}: ${unchecked}`);

  if (duplicates.length) {
    console.log(`[${mode}] duplicate handles:`);
    duplicates.forEach((duplicate) => {
      console.log(`  - ${duplicate.handle}: ${duplicate.statuses.join(" -> ")}`);
    });
  }
}

function supabaseHeaders(env, extra = {}) {
  return {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
    ...extra,
  };
}

async function upsertBatch(env, rows) {
  const headers = supabaseHeaders(env, {
    "content-type": "application/json",
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  const body = JSON.stringify(rows);
  const conflictTargets = ["seller_id", "seller_name"];
  let lastError = "";

  for (const conflictTarget of conflictTargets) {
    const response = await fetch(
      `${env.supabaseUrl}/rest/v1/${TABLE}?on_conflict=${encodeURIComponent(conflictTarget)}`,
      { method: "POST", headers, body }
    );
    const text = await response.text();
    if (response.ok) return;

    lastError = `Supabase upsert failed (${response.status}, on_conflict=${conflictTarget}): ${text}`;
    if (/on_conflict|conflict|duplicate key/i.test(text || "")) continue;
    throw new Error(lastError);
  }

  throw new Error(lastError);
}

async function fetchAllCandidateStatuses(env) {
  const response = await fetch(
    `${env.supabaseUrl}/rest/v1/${TABLE}?select=seller_name,seller_id,dm_status,review_status,assignee&limit=10000`,
    {
      headers: supabaseHeaders(env, { accept: "application/json" }),
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase verification fetch failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) : [];
}

async function verifyImport(env, importedRows) {
  const importedHandles = new Set(importedRows.map((row) => row.handle));
  const candidates = await fetchAllCandidateStatuses(env);
  const importedCandidates = candidates.filter((row) => {
    const handle = normalizeHandle(row.seller_id || row.seller_name);
    return importedHandles.has(handle);
  });

  const assigned = importedCandidates.filter((row) => row.assignee === ASSIGNEE).length;
  const sent = importedCandidates.filter((row) => row.assignee === ASSIGNEE && row.dm_status === DM_SENT).length;
  const unchecked = importedCandidates.filter(
    (row) => row.assignee === ASSIGNEE && row.dm_status === DM_UNSENT && row.review_status === REVIEW_UNCHECKED
  ).length;

  console.log(`[verify] imported handles found: ${importedCandidates.length} / ${importedHandles.size}`);
  console.log(`[verify] assignee=${ASSIGNEE}: ${assigned}`);
  console.log(`[verify] dm_status=${DM_SENT}: ${sent}`);
  console.log(`[verify] dm_status=${DM_UNSENT}, review_status=${REVIEW_UNCHECKED}: ${unchecked}`);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const { totalDocuments, rows: legacyRows } = await fetchFirestoreInfluencers();
  const { rows: dedupedRows, duplicates } = dedupeRows(legacyRows);
  printSummary({ totalDocuments, legacyRows, dedupedRows, duplicates, mode: dryRun ? "dry-run" : "import" });

  if (dryRun) return;

  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const now = new Date().toISOString();
  const patches = dedupedRows.map((row) => toSupabasePatch(row, now));
  const batchSize = 100;

  for (let index = 0; index < patches.length; index += batchSize) {
    const batch = patches.slice(index, index + batchSize);
    await upsertBatch(env, batch);
    console.log(`[import] ${Math.min(index + batch.length, patches.length)} / ${patches.length}`);
  }

  await verifyImport(env, dedupedRows);
  console.log(`[done] imported GUGU Firestore handles: ${dedupedRows.length}`);
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
