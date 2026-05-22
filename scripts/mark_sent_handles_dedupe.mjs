import { readSupabaseEnv } from "./supabase_env.mjs";

const TABLE = "beauty_seller_candidates";
const SELECT_LIMIT = 20000;
const TARGET_ASSIGNEE = "김시은";
const SENT_HANDLES = [
  "youxria",
  "dalla__young",
  "ding__ding2",
  "mnnxi__",
  "un2.ve",
  "pringbee",
  "sulinmyung",
  "code__makeup",
  "seoliynne",
  "da._.woooooon",
  "u_9.9",
  "hjj_starry__cos",
  "seria_980",
  "maedamong",
  "spring_bibi_makeup",
  "sourfridge",
  "uhyeoniz",
  "hwitto_",
  "lux.som",
  "uxzic_",
  "einey_makeup",
  "amiyameinoella",
  "aut.mmt",
  "rockchaeeun",
  "sena__cho",
  "sky__jj",
  "binibininnn",
  "kiki_12.4",
  "innshushu",
  "j.hyun_only",
  "rabbiitluv",
  "anssxmetic",
  "itsdamiduck",
  "visagevoid_",
  "c_omely_1st",
  "zyyunmm",
  "se0_my",
  "dayaremuses",
  "uttie_beauty",
  "zzangsezii",
  "soeunsi",
  "euteamuuo",
  "yunnx.nn",
  "gxexx16",
  "__withdanni",
  "seovoon",
  "xxuz_08",
  "mond_ovo",
  "peng_pongping",
  "juju_juhui",
  "hi.yoni__",
  "ioucosbutimstudent",
  "ddaengunitem",
  "gimingkkeu",
  "sonho.archives",
  "ivmmiix",
  "min9_uri",
  "y.only01",
  "luv_u_m0re",
  "mi_ngti",
  "se_ko.d.0",
];

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

function headers(env, extra = {}) {
  return {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
    ...extra,
  };
}

function normalizeHandle(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/instagram\.com\/(?!p\/|reel\/|tv\/|explore\/|accounts\/)([A-Za-z0-9._]+)/i);
  return (match ? match[1] : raw)
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .replace(/\/+$/, "")
    .trim()
    .toLowerCase();
}

function rowHandles(row) {
  return [
    normalizeHandle(row.seller_id),
    normalizeHandle(row.profile_url),
    normalizeHandle(row.seller_name),
  ].filter(Boolean);
}

function rank(row) {
  const sentBonus = row.dm_status === "발송완료" ? 2_000_000_000_000 : 0;
  const updated = Date.parse(row.status_updated_at || row.updated_at || 0) || 0;
  return sentBonus + updated + Number(row.id || 0) / 1_000_000;
}

async function fetchRows(env) {
  const params = new URLSearchParams({
    select: "id,seller_name,seller_id,profile_url,dm_status,review_status,status_updated_at,updated_at",
    limit: String(SELECT_LIMIT),
  });
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?${params}`, {
    headers: headers(env, {
      accept: "application/json",
      range: `0-${SELECT_LIMIT - 1}`,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
  }

async function patchSent(env, id) {
  const now = new Date().toISOString();
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers(env, {
      "content-type": "application/json",
      prefer: "return=minimal",
    }),
    body: JSON.stringify({
      dm_status: "발송완료",
      assignee: TARGET_ASSIGNEE,
      status_updated_by: "mark_sent_handles_dedupe",
      status_updated_at: now,
      last_contacted_at: now,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`patch failed id=${id}: ${response.status}: ${text}`);
}

async function deleteRows(env, ids) {
  if (!ids.length) return;
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
    method: "DELETE",
    headers: headers(env, {
      prefer: "return=minimal",
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`delete failed: ${response.status}: ${text}`);
}

async function main() {
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const args = parseArgs(process.argv.slice(2));
  const targets = new Set(SENT_HANDLES.map(normalizeHandle));
  const rows = await fetchRows(env);
  const groups = new Map();

  for (const row of rows) {
    const matchedHandles = rowHandles(row).filter((handle) => targets.has(handle));
    for (const handle of new Set(matchedHandles)) {
      if (!groups.has(handle)) groups.set(handle, []);
      groups.get(handle).push(row);
    }
  }

  const found = [...groups.keys()].sort();
  const missing = [...targets].filter((handle) => !groups.has(handle)).sort();
  const plans = found.map((handle) => {
    const matches = groups.get(handle).sort((a, b) => rank(b) - rank(a));
    return {
      handle,
      keep: matches[0],
      duplicates: matches.slice(1),
    };
  });

  console.log(`[sent] targets=${targets.size} found=${found.length} missing=${missing.length}`);
  if (found.length) console.log(`[sent] found: ${found.map((handle) => `@${handle}`).join(", ")}`);
  if (missing.length) console.log(`[sent] missing: ${missing.map((handle) => `@${handle}`).join(", ")}`);

  const duplicateIds = plans.flatMap((plan) => plan.duplicates.map((row) => row.id));
  console.log(`[sent] duplicate rows to delete=${duplicateIds.length}`);
  plans
    .filter((plan) => plan.duplicates.length)
    .forEach((plan) => {
      console.log(`[dedupe] @${plan.handle}: keep id=${plan.keep.id}, delete ids=${plan.duplicates.map((row) => row.id).join(",")}`);
    });

  if (args.dryRun) {
    console.log("[sent] dry-run only. Supabase was not modified.");
    return;
  }

  for (const plan of plans) {
    await patchSent(env, plan.keep.id);
    console.log(`[sent] @${plan.handle} -> 발송완료 (id=${plan.keep.id})`);
  }

  for (let index = 0; index < duplicateIds.length; index += 150) {
    await deleteRows(env, duplicateIds.slice(index, index + 150));
    console.log(`[dedupe] deleted ${Math.min(index + 150, duplicateIds.length)} / ${duplicateIds.length}`);
  }

  console.log("[sent] done.");
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
