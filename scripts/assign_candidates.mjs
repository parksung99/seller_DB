import { readSupabaseEnv } from "./supabase_env.mjs";

const TABLE = "beauty_seller_candidates";

function parseArgs(argv) {
  const args = {
    members: [],
    perMemberLimit: 30,
    limit: 10000,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--members") {
      args.members = String(argv[++i] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (arg === "--per-member-limit") {
      args.perMemberLimit = Number(argv[++i]);
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]);
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }

  if (!Number.isFinite(args.perMemberLimit) || args.perMemberLimit <= 0) args.perMemberLimit = 30;
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

function normalizeHandle(row) {
  const value =
    row.seller_id ||
    row.seller_name ||
    String(row.profile_url || "").match(/instagram\.com\/([^/?#]+)/i)?.[1] ||
    "";
  return String(value)
    .trim()
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function score(row) {
  return Number(row.follower_count || 0) + Number(row.engagement_rate || 0);
}

async function fetchCandidates(env, args) {
  const columnSets = [
    "id,seller_name,seller_id,profile_url,assignee,follower_count,engagement_rate,avg_likes,avg_comments,updated_at",
    "id,seller_name,profile_url,assignee,follower_count,engagement_rate,updated_at",
    "*",
  ];

  let lastError = "";
  for (const columns of columnSets) {
    const params = new URLSearchParams();
    params.set("select", columns);
    params.set("limit", String(args.limit));

    const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?${params}`, {
      headers: headers(env, { accept: "application/json" }),
    });
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : [];
    lastError = `Supabase load failed (${response.status}): ${text}`;
    if (!text.includes("does not exist")) break;
  }

  throw new Error(lastError);
}

async function patchAssignee(env, row, assignee) {
  const payload = {
    assignee,
    status_updated_by: "assign_candidates",
    status_updated_at: new Date().toISOString(),
  };
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: headers(env, {
      "content-type": "application/json",
      prefer: "return=minimal",
    }),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Assign failed @${row.seller_name || row.seller_id}: ${response.status}: ${text}`);
}

function buildAssignments(rows, members, perMemberLimit) {
  const seen = new Set();
  const counts = Object.fromEntries(members.map((name) => [name, 0]));
  const assignments = [];
  const candidates = rows
    .filter((row) => !String(row.assignee || "").trim())
    .filter((row) => {
      const handle = normalizeHandle(row);
      if (!handle || seen.has(handle)) return false;
      seen.add(handle);
      return true;
    })
    .sort((a, b) => score(b) - score(a));

  let memberIndex = 0;
  for (const row of candidates) {
    const availableMembers = members.filter((name) => counts[name] < perMemberLimit);
    if (!availableMembers.length) break;

    let assignee = null;
    for (let attempt = 0; attempt < members.length; attempt += 1) {
      const candidateMember = members[memberIndex % members.length];
      memberIndex += 1;
      if (counts[candidateMember] < perMemberLimit) {
        assignee = candidateMember;
        break;
      }
    }
    if (!assignee) continue;

    counts[assignee] += 1;
    assignments.push({ row, assignee });
  }

  return { assignments, counts, skippedAlreadyAssigned: rows.length - rows.filter((row) => !String(row.assignee || "").trim()).length };
}

async function main() {
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.members.length !== 2) {
    throw new Error('Exactly two team members are required. Example: --members "팀원A,팀원B"');
  }

  const rows = await fetchCandidates(env, args);
  const { assignments, counts, skippedAlreadyAssigned } = buildAssignments(rows, args.members, args.perMemberLimit);

  console.log(`[assign] loaded=${rows.length} already_assigned=${skippedAlreadyAssigned} planned=${assignments.length}`);
  for (const member of args.members) {
    console.log(`[assign] ${member}: ${counts[member]}`);
  }

  if (args.dryRun) {
    assignments.slice(0, 20).forEach(({ row, assignee }, index) => {
      console.log(`[dry-run] ${index + 1}. @${row.seller_name || row.seller_id} -> ${assignee}`);
    });
    console.log("[assign] dry-run only. Supabase was not modified.");
    return;
  }

  for (const { row, assignee } of assignments) {
    await patchAssignee(env, row, assignee);
    console.log(`[assign] @${row.seller_name || row.seller_id} -> ${assignee}`);
  }
  console.log("[assign] done.");
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
