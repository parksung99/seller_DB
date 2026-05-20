import { readSupabaseEnv } from "./supabase_env.mjs";

export const TABLE = "beauty_seller_candidates";
export const EXCLUDED_TABLE = "excluded_instagram_handles";
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
  const rawCode =
    headers["x-team-access-code"] ||
    headers["X-Team-Access-Code"] ||
    headers.get?.("x-team-access-code") ||
    body.access_code;
  if (typeof rawCode !== "string" || !rawCode) {
    const error = new Error("\uC811\uADFC \uCF54\uB4DC\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    error.status = 401;
    throw error;
  }

  const code = rawCode.startsWith("b64:")
    ? (() => {
        const decoded = Buffer.from(rawCode.slice(4), "base64").toString("utf8");
        try {
          return decodeURIComponent(decoded);
        } catch {
          return decoded;
        }
      })()
    : (() => {
        try {
          return decodeURIComponent(rawCode);
        } catch {
          return rawCode;
        }
      })();

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
    const error = new Error(text || "supabase request failed");
    error.status = response.status;
    error.body = text;
    throw error;
  }

  return text ? JSON.parse(text) : null;
}

function isMissingRelation(error) {
  if (!error || error.status !== 404) return false;
  return /Could not find|does not exist|schema cache/i.test(String(error.body || error.message || ""));
}

function cleanSearch(value) {
  return String(value || "").replace(/[(),]/g, " ").trim();
}

function instagramHandleFromUrl(value) {
  const match = String(value || "").match(/instagram\.com\/(?!p\/|reel\/|tv\/|explore\/|accounts\/)([A-Za-z0-9._]+)/i);
  return match ? match[1].toLowerCase() : "";
}

export function normalizeInstagramHandle(value) {
  const raw = String(value || "").trim().replace(/^@/, "").replace(/\/+$/, "");
  if (!raw) return "";
  const match = raw.match(/instagram\.com\/(?!p\/|reel\/|tv\/|explore\/|accounts\/)([A-Za-z0-9._]+)/i);
  return (match ? match[1] : raw).trim().replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
}

function normalizeHandleFromRow(row) {
  return normalizeInstagramHandle(row?.seller_id || row?.profile_url || row?.seller_name || "");
}

async function listExcludedHandles() {
  try {
    const rows = await supabaseFetch(`${EXCLUDED_TABLE}?select=handle&limit=10000`, {
      headers: { accept: "application/json" },
    });
    return new Set((rows || []).map((row) => normalizeInstagramHandle(row.handle)).filter(Boolean));
  } catch (error) {
    if (isMissingRelation(error)) return new Set();
    throw error;
  }
}

async function isHandleExcluded(handle) {
  const normalized = normalizeInstagramHandle(handle);
  if (!normalized) return false;
  try {
    const rows = await supabaseFetch(
      `${EXCLUDED_TABLE}?select=handle&handle=eq.${encodeURIComponent(normalized)}&limit=1`,
      { headers: { accept: "application/json" } }
    );
    return Boolean(rows?.length);
  } catch (error) {
    if (isMissingRelation(error)) return false;
    throw error;
  }
}

async function upsertExcludedHandle(handle, { reason = "manual_review_excluded", source = "review_app", excludedBy = "unknown" } = {}) {
  const normalized = normalizeInstagramHandle(handle);
  if (!normalized) return null;
  try {
    return await supabaseFetch(`${EXCLUDED_TABLE}?on_conflict=handle`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        handle: normalized,
        reason,
        source,
        excluded_by: excludedBy,
      }),
    });
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

function searchTerms(value) {
  const query = cleanSearch(value);
  const handle = instagramHandleFromUrl(query);
  return [...new Set([query, handle].filter(Boolean))];
}

function parseMissingColumn(error) {
  if (!error || !error.body || error.status !== 400) return null;
  try {
    const payload = JSON.parse(error.body);
    const msg = String(payload.message || error.message || "");
    const match = msg.match(/column\s+([\w\.]+)\s+does not exist/i);
    if (!match) return null;
    return match[1].split(".").pop();
  } catch {
    const msg = String(error.message || "");
    const match = msg.match(/column\s+([\w\.]+)\s+does not exist/i);
    if (!match) return null;
    return match[1].split(".").pop();
  }
}

function removeColumn(columns, missing) {
  if (!missing) return columns;
  const cleaned = columns.filter((name) => name !== missing);
  if (cleaned.length === columns.length) return columns;
  return cleaned;
}

async function queryCandidates(url, options = {}) {
  const params = url.searchParams;
  let orColumns = [...options.orColumns];
  const order = options.order || "grade.desc,combination_score.desc,beauty_score.desc,total_comments.desc";
  const grade = options.hasOwnProperty("grade") ? options.grade : params.get("grade");
  const reviewStatus = options.hasOwnProperty("reviewStatus") ? options.reviewStatus : params.get("review_status");
  const dmStatus = options.hasOwnProperty("dmStatus") ? options.dmStatus : params.get("dm_status");
  const assignee = options.hasOwnProperty("assignee") ? options.assignee : params.get("assignee");
  const unassigned = options.hasOwnProperty("unassigned") ? options.unassigned : params.get("unassigned") === "1";
  const includeExcluded = options.hasOwnProperty("includeExcluded")
    ? options.includeExcluded
    : params.get("include_excluded") === "1";

  const selectColumns = options.selectColumns || "*";
  const queries = searchTerms(params.get("q"));

  const apiParams = new URLSearchParams();
  apiParams.set("select", selectColumns);
  apiParams.set("order", order);
  apiParams.set("limit", "500");
  if (grade) apiParams.set("grade", `eq.${grade}`);
  if (reviewStatus) apiParams.set("review_status", `eq.${reviewStatus}`);
  if (dmStatus) apiParams.set("dm_status", `eq.${dmStatus}`);
  if (assignee) apiParams.set("assignee", `eq.${assignee}`);
  if (unassigned) apiParams.set("assignee", "is.null");
  if (queries.length && orColumns.length) {
    const joinedOr = orColumns
      .flatMap((name) => queries.map((query) => `${name}.ilike.*${query}*`))
      .join(",");
    apiParams.set("or", `(${joinedOr})`);
  }

  try {
    const rows = await supabaseFetch(`${TABLE}?${apiParams.toString()}`, {
      headers: { accept: "application/json" },
    });
    if (includeExcluded || reviewStatus === "\uC81C\uC678") return rows;
    const excluded = await listExcludedHandles();
    return rows.filter((row) => row.review_status !== "\uC81C\uC678" && !excluded.has(normalizeHandleFromRow(row)));
  } catch (error) {
    const missing = parseMissingColumn(error);
    if (missing) {
      if (missing === "grade" && grade) {
        return queryCandidates(url, { ...options, grade: null });
      }
      if (missing === "review_status" && reviewStatus) {
        return queryCandidates(url, { ...options, reviewStatus: null });
      }
      if (missing === "dm_status" && dmStatus) {
        return queryCandidates(url, { ...options, dmStatus: null });
      }
      if (missing === "assignee" && assignee) {
        return queryCandidates(url, { ...options, assignee: null });
      }
      const nextOr = removeColumn(orColumns, missing);
      if (nextOr.length !== orColumns.length) {
        return queryCandidates(url, { order, selectColumns, orColumns: nextOr });
      }
      if (selectColumns !== "*" && selectColumns.includes(missing)) {
        const nextColumns = removeColumn(selectColumns.split(","), missing).join(",");
        return queryCandidates(url, { ...options, orColumns, selectColumns: nextColumns });
      }
    }
    throw error;
  }

}

export async function listCandidates(url) {
  const initialOrColumns = [
    "seller_name",
    "seller_id",
    "profile_url",
    "matched_hashtags",
    "sample_post_urls",
    "engagement_posts",
    "notes",
    "memo",
  ];

  try {
    return await queryCandidates(url, {
      order: "grade.desc,combination_score.desc,beauty_score.desc,total_comments.desc",
      orColumns: initialOrColumns,
      selectColumns: "id,seller_name,seller_id,profile_url,grade,matched_hashtags,category,beauty_score,selling_score,negative_score,combination_score,total_likes,total_comments,avg_likes,avg_comments,follower_count,beauty_anchor_tags,commercial_signal_tags,format_signal_tags,engagement_rate,engagement_post_count,engagement_posts,engagement_refresh_error,last_engagement_refresh_at,review_status,dm_status,brand_fit,assignee,memo,sample_post_urls,notes,status_updated_by,status_updated_at,last_contacted_at,updated_at",
    });
  } catch (error) {
    const missing = parseMissingColumn(error);
    if (missing) {
      return queryCandidates(url, {
        order: "grade.desc,combination_score.desc,beauty_score.desc,total_comments.desc",
        orColumns: ["seller_name", "seller_id", "profile_url", "notes", "memo"],
        selectColumns: "*",
      });
    }
    throw error;
  }
}

function normalizeSellerId(value) {
  const raw = String(value || "").trim().replace(/^@/, "").replace(/\/+$/, "");
  if (!raw) return "";
  const match = raw.match(/instagram\.com\/([^/?#]+)/i);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function createCandidate(patch, actor) {
  const sellerId = normalizeSellerId(patch.seller_id || patch.handle || patch.seller_name || patch.profile_url);
  const sellerName = String(patch.seller_name || sellerId || "").trim().replace(/^@/, "");
  if (!sellerName) {
    const error = new Error("seller_name is required.");
    error.status = 400;
    throw error;
  }
  if (await isHandleExcluded(sellerId || sellerName || patch.profile_url)) {
    const error = new Error("excluded instagram handle.");
    error.status = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const body = {
    seller_name: sellerName,
    seller_id: sellerId || null,
    channel: "instagram",
    profile_url: patch.profile_url || (sellerId ? `https://www.instagram.com/${sellerId}/` : null),
    category: patch.category || null,
    follower_count: toInteger(patch.follower_count),
    avg_likes: toInteger(patch.avg_likes),
    avg_comments: toInteger(patch.avg_comments),
    engagement_rate: toNumberOrNull(patch.engagement_rate),
    review_status: patch.review_status || REVIEW_STATUSES[0],
    dm_status: patch.dm_status || DM_STATUSES[0],
    brand_fit: patch.brand_fit || null,
    assignee: patch.assignee || null,
    memo: patch.memo || null,
    notes: patch.notes || null,
    status_updated_by: String(actor || patch.assignee || "").trim() || "unknown",
    status_updated_at: now,
  };

  return supabaseFetch(`${TABLE}?on_conflict=seller_name`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(body),
  });
}

export async function updateCandidate(id, patch, actor) {
  const blocked = new Set(["id", "access_code", "actor", "created_at", "updated_at"]);
  const body = Object.fromEntries(
    Object.entries(patch)
      .filter(([key]) => !blocked.has(key))
      .map(([key, value]) => [key, value === undefined ? null : value])
  );

  if (!Object.keys(body).length) return null;

  const now = new Date().toISOString();
  body.status_updated_by = String(actor || "").trim() || "unknown";
  body.status_updated_at = now;
  if (body.dm_status === DM_STATUSES[1] || body.dm_status === DM_STATUSES[2]) {
    body.last_contacted_at = now;
  }

  const updated = await supabaseFetch(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const row = Array.isArray(updated) ? updated[0] : null;
  if (body.review_status === "\uC81C\uC678" && row) {
    await upsertExcludedHandle(normalizeHandleFromRow(row), {
      reason: "manual_review_excluded",
      source: "review_app",
      excludedBy: body.status_updated_by,
    });
  }
  return updated;
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
