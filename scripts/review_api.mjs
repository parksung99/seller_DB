import { readSupabaseEnv } from "./supabase_env.mjs";

export const TABLE = "beauty_seller_candidates";
export const REVIEW_STATUSES = ["\uBBF8\uD655\uC778", "\uC88B\uC74C", "\uBCF4\uB958", "\uC81C\uC678", "\uBE0C\uB79C\uB4DC\uC804\uB2EC"];
export const DM_STATUSES = ["\uBBF8\uBC1C\uC1A1", "\uBC1C\uC1A1\uC644\uB8CC", "\uB2F5\uC7A5\uC634", "\uAC70\uC808", "\uBCF4\uB958"];
export const BRAND_FITS = ["", "\uB192\uC74C", "\uC911\uAC04", "\uB0AE\uC74C"];

const env = readSupabaseEnv();

function supabaseHeaders(extra = {}) {
  return {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
    ...extra,
  };
}

export function assertConfigured() {
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  }
}

export function verifyAccessCode(request, body = {}) {
  if (!env.teamAccessCode) return;

  const headers = request.headers || {};
  const code =
    headers["x-team-access-code"] ||
    headers["X-Team-Access-Code"] ||
    headers.get?.("x-team-access-code") ||
    body.access_code;

  if (code !== env.teamAccessCode) {
    const error = new Error("\uC811\uADFC \uCF54\uB4DC\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    error.status = 401;
    throw error;
  }
}

export function sendJson(response, status, data) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

export async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function supabaseFetch(path, options = {}) {
  assertConfigured();

  const response = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(options.headers),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

function cleanSearch(value) {
  return String(value || "").replace(/[(),]/g, " ").trim();
}

export async function listCandidates(url) {
  const params = url.searchParams;
  const grade = params.get("grade");
  const reviewStatus = params.get("review_status");
  const dmStatus = params.get("dm_status");
  const assignee = params.get("assignee");
  const query = cleanSearch(params.get("q"));

  const apiParams = new URLSearchParams();
  apiParams.set(
    "select",
    [
      "id",
      "seller_name",
      "profile_url",
      "grade",
      "matched_hashtags",
      "category",
      "beauty_score",
      "selling_score",
      "negative_score",
      "combination_score",
      "total_likes",
      "total_comments",
      "beauty_anchor_tags",
      "commercial_signal_tags",
      "format_signal_tags",
      "review_status",
      "dm_status",
      "brand_fit",
      "assignee",
      "memo",
      "sample_post_urls",
      "notes",
      "status_updated_by",
      "status_updated_at",
      "last_contacted_at",
      "updated_at",
    ].join(",")
  );
  apiParams.set("order", "grade.desc,combination_score.desc,beauty_score.desc,total_comments.desc");
  apiParams.set("limit", "500");
  if (grade) apiParams.set("grade", `eq.${grade}`);
  if (reviewStatus) apiParams.set("review_status", `eq.${reviewStatus}`);
  if (dmStatus) apiParams.set("dm_status", `eq.${dmStatus}`);
  if (assignee) apiParams.set("assignee", `eq.${assignee}`);
  if (query) {
    apiParams.set(
      "or",
      `(seller_name.ilike.*${query}*,matched_hashtags.ilike.*${query}*,notes.ilike.*${query}*,memo.ilike.*${query}*)`
    );
  }

  return supabaseFetch(`${TABLE}?${apiParams.toString()}`, {
    headers: { accept: "application/json" },
  });
}

export async function updateCandidate(id, patch, actor) {
  const allowed = ["review_status", "dm_status", "brand_fit", "memo", "assignee"];
  const body = Object.fromEntries(
    Object.entries(patch)
      .filter(([key]) => allowed.includes(key))
      .map(([key, value]) => [key, value === undefined ? null : value])
  );

  if (!Object.keys(body).length) return null;

  const now = new Date().toISOString();
  body.status_updated_by = String(actor || "").trim() || "unknown";
  body.status_updated_at = now;
  if (body.dm_status === "발송완료" || body.dm_status === "답장옴") {
    body.last_contacted_at = now;
  }

  return supabaseFetch(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
}

export async function stats() {
  const rows = await supabaseFetch(
    `${TABLE}?select=grade,review_status,dm_status,assignee,combination_score&limit=10000`,
    { headers: { accept: "application/json" } }
  );
  const countBy = (key) =>
    rows.reduce((acc, row) => {
      const value = row[key] || "\uC5C6\uC74C";
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

  return {
    total: rows.length,
    byGrade: countBy("grade"),
    byReviewStatus: countBy("review_status"),
    byDmStatus: countBy("dm_status"),
    byAssignee: countBy("assignee"),
    assignees: [...new Set(rows.map((row) => row.assignee).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
  };
}

export function handleError(response, error) {
  sendJson(response, error.status || 500, { error: error.message || "\uC11C\uBC84 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4." });
}
