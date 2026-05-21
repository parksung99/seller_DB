import { readSupabaseEnv } from "./supabase_env.mjs";

const TABLE = "beauty_seller_candidates";
const EXCLUDED_TABLE = "excluded_instagram_handles";
const DEFAULT_MEMBERS = ["김시은", "박민서"];
const REVIEW_UNCHECKED = "미확인";
const TRASH_REASON_OUT_OF_RANGE = "out_of_follower_range";

const MEMBER_RULES = {
  "김시은": { min: 5000, max: 100000 },
  "박민서": { min: 1000, max: 50000 },
};

function parseArgs(argv) {
  const args = {
    members: DEFAULT_MEMBERS,
    limit: 10000,
    dryRun: false,
    includeAssigned: false,
    includeOutOfRange: false,
    unassignOutOfRange: false,
    skipTrashOutOfRange: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--members") {
      args.members = String(argv[++i] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]);
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--skip-out-of-range-exclude") {
      // Kept as a no-op for older pipeline commands.
    } else if (arg === "--include-assigned") {
      args.includeAssigned = true;
    } else if (arg === "--include-out-of-range") {
      args.includeOutOfRange = true;
    } else if (arg === "--unassign-out-of-range") {
      args.unassignOutOfRange = true;
      args.includeAssigned = true;
    } else if (arg === "--skip-trash-out-of-range") {
      args.skipTrashOutOfRange = true;
    }
  }

  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 10000;
  return args;
}

function headers(env, extra = {}) {
  return {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
    ...extra,
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

function followerCount(row) {
  const value = Number(row.follower_count || 0);
  return Number.isFinite(value) ? value : 0;
}

function score(row) {
  return (
    Number(row.combination_score || 0) * 1000000 +
    Number(row.beauty_score || 0) * 10000 +
    Number(row.follower_count || 0) +
    Number(row.engagement_rate || 0)
  );
}

function canAssign(member, row) {
  const rule = MEMBER_RULES[member];
  const followers = followerCount(row);
  return Boolean(rule && followers >= rule.min && followers <= rule.max);
}

async function supabaseJson(env, path, options = {}) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: headers(env, options.headers || {}),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${response.status}: ${text}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

async function fetchCandidates(env, args) {
  const params = new URLSearchParams();
  params.set("select", "id,seller_name,seller_id,profile_url,assignee,review_status,follower_count,engagement_rate,beauty_score,combination_score,updated_at");
  params.set("limit", String(args.limit));
  params.set("or", `(review_status.is.null,review_status.eq.${REVIEW_UNCHECKED})`);
  if (!args.includeAssigned) params.set("assignee", "is.null");
  return supabaseJson(env, `${TABLE}?${params}`, { headers: { accept: "application/json" } });
}

async function fetchExcludedHandles(env) {
  try {
    const rows = await supabaseJson(env, `${EXCLUDED_TABLE}?select=handle&limit=10000`, {
      headers: { accept: "application/json" },
    });
    return new Set((rows || []).map((row) => normalizeHandle(row.handle)).filter(Boolean));
  } catch (error) {
    if (error.status === 404) return fetchCandidateExcludedHandles(env);
    throw error;
  }
}

async function fetchCandidateExcludedHandles(env) {
  const rows = await supabaseJson(
    env,
    `${TABLE}?select=seller_id,seller_name,profile_url&review_status=eq.%EC%A0%9C%EC%99%B8&limit=10000`,
    { headers: { accept: "application/json" } }
  );
  return new Set((rows || []).map(handleFromRow).filter(Boolean));
}

async function patchAssignee(env, row, assignee) {
  const payload = {
    assignee,
    status_updated_by: "assign_candidates",
    status_updated_at: new Date().toISOString(),
  };
  await supabaseJson(env, `${TABLE}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });
}

async function upsertTrashHandle(env, row) {
  const handle = handleFromRow(row);
  if (!handle) return;
  const followers = followerCount(row);
  await supabaseJson(env, `${EXCLUDED_TABLE}?on_conflict=handle`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      handle,
      reason: TRASH_REASON_OUT_OF_RANGE,
      source: `assign_candidates:follower_count=${followers}`,
      excluded_by: "assign_candidates",
    }),
  });
}

function buildAssignments(rows, members, excludedHandles, args = {}) {
  const seen = new Set();
  const counts = Object.fromEntries(members.map((name) => [name, 0]));
  const assignments = [];
  const outOfRange = [];
  const missingFollowers = [];

  const candidates = rows
    .filter((row) => {
      const handle = handleFromRow(row);
      if (row.assignee) return false;
      if (!handle || seen.has(handle) || excludedHandles.has(handle)) return false;
      seen.add(handle);
      return true;
    })
    .sort((a, b) => score(b) - score(a));

  const eligibleItems = [];
  for (const row of candidates) {
    const eligible = members.filter((member) => canAssign(member, row));
    if (!followerCount(row)) {
      missingFollowers.push(row);
      if (!args.includeOutOfRange) continue;
    } else if (!eligible.length) {
      outOfRange.push(row);
      if (!args.includeOutOfRange) continue;
    }
    eligibleItems.push({ row, eligible: eligible.length ? eligible : members });
  }

  const orderedItems = [
    ...eligibleItems.filter((item) => item.eligible.length === 1),
    ...eligibleItems.filter((item) => item.eligible.length > 1),
  ];

  for (const { row, eligible } of orderedItems) {
    const assignee = [...eligible].sort((a, b) => {
      const countDiff = counts[a] - counts[b];
      if (countDiff !== 0) return countDiff;
      return members.indexOf(a) - members.indexOf(b);
    })[0];

    counts[assignee] += 1;
    assignments.push({ row, assignee });
  }

  return { assignments, counts, outOfRange, missingFollowers };
}

function buildTrashRows(outOfRange, excludedHandles) {
  const seen = new Set();
  return outOfRange.filter((row) => {
    const handle = handleFromRow(row);
    if (!handle || seen.has(handle) || excludedHandles.has(handle)) return false;
    seen.add(handle);
    return true;
  });
}

function buildUnassignments(rows, members, excludedHandles) {
  const seen = new Set();
  return rows.filter((row) => {
    const handle = handleFromRow(row);
    if (!row.assignee || !members.includes(row.assignee)) return false;
    if (!handle || seen.has(handle) || excludedHandles.has(handle)) return false;
    seen.add(handle);
    return Boolean(followerCount(row)) && !canAssign(row.assignee, row);
  });
}

async function main() {
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.members.length !== 2 || args.members.some((member) => !MEMBER_RULES[member])) {
    throw new Error(`Supported members: ${DEFAULT_MEMBERS.join(", ")}`);
  }

  const rows = await fetchCandidates(env, args);
  const excludedHandles = await fetchExcludedHandles(env);
  const { assignments, counts, outOfRange, missingFollowers } = buildAssignments(rows, args.members, excludedHandles, args);
  const unassignments = args.unassignOutOfRange ? buildUnassignments(rows, args.members, excludedHandles) : [];
  const previouslyAssignedOutOfRange = unassignments.filter((row) => followerCount(row) && !canAssign(row.assignee, row));
  const trashRows = args.skipTrashOutOfRange || args.includeOutOfRange
    ? []
    : buildTrashRows([...outOfRange, ...previouslyAssignedOutOfRange], excludedHandles);

  console.log(`[assign] loaded=${rows.length} excluded_handles=${excludedHandles.size} planned=${assignments.length}`);
  for (const member of args.members) {
    console.log(`[assign] ${member}: ${counts[member]}`);
  }
  console.log(`[assign] missing_followers=${missingFollowers.length} out_of_range=${outOfRange.length} trash_out_of_range=${trashRows.length} unassign_out_of_range=${unassignments.length}`);

  if (args.dryRun) {
    assignments.slice(0, 30).forEach(({ row, assignee }, index) => {
      console.log(`[dry-run] ${index + 1}. @${row.seller_name || row.seller_id} (${followerCount(row)}) -> ${assignee}`);
    });
    trashRows.slice(0, 30).forEach((row, index) => {
      console.log(`[dry-run:trash] ${index + 1}. @${row.seller_name || row.seller_id} (${followerCount(row)}) -> ${TRASH_REASON_OUT_OF_RANGE}`);
    });
    unassignments.slice(0, 30).forEach((row, index) => {
      console.log(`[dry-run:unassign] ${index + 1}. @${row.seller_name || row.seller_id} (${followerCount(row)}) was ${row.assignee}`);
    });
    console.log("[assign] dry-run only. Supabase was not modified.");
    return;
  }

  for (const { row, assignee } of assignments) {
    await patchAssignee(env, row, assignee);
    console.log(`[assign] @${row.seller_name || row.seller_id} (${followerCount(row)}) -> ${assignee}`);
  }

  for (const row of trashRows) {
    await upsertTrashHandle(env, row);
    console.log(`[trash] @${row.seller_name || row.seller_id} (${followerCount(row)}) -> ${TRASH_REASON_OUT_OF_RANGE}`);
  }

  for (const row of unassignments) {
    await patchAssignee(env, row, null);
    console.log(`[unassign] @${row.seller_name || row.seller_id} (${followerCount(row)}) was ${row.assignee}`);
  }

  console.log("[assign] done.");
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
