import { readSupabaseEnv } from "./supabase_env.mjs";

export const TABLE = "beauty_seller_candidates";
export const EXCLUDED_TABLE = "excluded_instagram_handles";
export const CAMPAIGNS_TABLE = "outreach_campaigns";
export const RECIPIENTS_TABLE = "outreach_recipients";
export const MESSAGES_TABLE = "outreach_messages";
export const REVIEW_STATUSES = ["\uBBF8\uD655\uC778", "\uC88B\uC74C", "\uBCF4\uB958", "\uC81C\uC678", "\uBE0C\uB79C\uB4DC\uC804\uB2EC"];
export const DM_STATUSES = ["\uBBF8\uBC1C\uC1A1", "\uBC1C\uC1A1\uC644\uB8CC", "\uB2F5\uC7A5\uC634", "\uAC70\uC808", "\uBCF4\uB958"];
export const EMAIL_STATUSES = ["\uBBF8\uBC1C\uC1A1", "\uBC1C\uC1A1\uC644\uB8CC", "\uB2F5\uC7A5\uC634", "\uBBF8\uD68C\uC2E0", "\uAC70\uC808", "\uBCF4\uB958"];
export const BRAND_FITS = ["", "\uB192\uC74C", "\uC911\uAC04", "\uB0AE\uC74C"];
export const GROUPBUY_EXPERIENCE_VALUES = ["\uBD88\uBA85", "\uC788\uC74C", "\uC5C6\uC74C"];
export const AGENCY_STATUS_VALUES = ["\uBD88\uBA85", "\uC788\uC74C", "\uC5C6\uC74C"];

const env = readSupabaseEnv();
const missingColumns = new Set();
const EXCLUDED_HANDLES_TTL_MS = 5000;
let excludedHandlesCache = { expiresAt: 0, handles: null };

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

export function sendJson(response, status, data) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.setHeader("pragma", "no-cache");
  response.setHeader("expires", "0");
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

function isMissingCampaignSchema(error) {
  return isMissingRelation(error) || /outreach_|profile_image_url|schema cache|does not exist/i.test(String(error?.body || error?.message || ""));
}

function isMissingRelation(error) {
  if (!error || error.status !== 404) return false;
  return /Could not find|does not exist|schema cache/i.test(String(error.body || error.message || ""));
}

function cleanSearch(value) {
  return String(value || "").replace(/[(),]/g, " ").trim();
}

function normalizeWithAllowed(value, allowed) {
  const normalized = String(value || "").trim();
  return allowed.includes(normalized) ? normalized : allowed[0];
}

function normalizeDmStatus(value) {
  const normalized = String(value || "").trim();
  if (normalized === "DM발송") return DM_STATUSES[1];
  return DM_STATUSES.includes(normalized) ? normalized : DM_STATUSES[0];
}

function expandDmStatusForFilter(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const normalized = normalizeDmStatus(raw);
  if (normalized === DM_STATUSES[1]) {
    return [DM_STATUSES[1], "DM발송"]; 
  }
  return [normalized];
}

function normalizeAgencyStatus(value) {
  const normalized = String(value || "").trim();
  if (normalized === "개인" || normalized === "에이전시") return "있음";
  return normalizeWithAllowed(normalized, AGENCY_STATUS_VALUES);
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
  const now = Date.now();
  if (excludedHandlesCache.handles && excludedHandlesCache.expiresAt > now) {
    return excludedHandlesCache.handles;
  }
  try {
    const rows = await supabaseFetch(`${EXCLUDED_TABLE}?select=handle&limit=10000`, {
      headers: { accept: "application/json" },
    });
    const handles = new Set((rows || []).map((row) => normalizeInstagramHandle(row.handle)).filter(Boolean));
    excludedHandlesCache = { handles, expiresAt: now + EXCLUDED_HANDLES_TTL_MS };
    return handles;
  } catch (error) {
    if (isMissingRelation(error)) return new Set();
    throw error;
  }
}

function invalidateExcludedHandlesCache() {
  excludedHandlesCache = { expiresAt: 0, handles: null };
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
    const result = await supabaseFetch(`${EXCLUDED_TABLE}?on_conflict=handle`, {
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
    invalidateExcludedHandlesCache();
    return result;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

async function deleteExcludedHandle(handle) {
  const normalized = normalizeInstagramHandle(handle);
  if (!normalized) return null;
  try {
    const result = await supabaseFetch(`${EXCLUDED_TABLE}?handle=eq.${encodeURIComponent(normalized)}`, {
      method: "DELETE",
      headers: { prefer: "return=minimal" },
    });
    invalidateExcludedHandlesCache();
    return result;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

export async function listExcludedDb(url) {
  const query = cleanSearch(url.searchParams.get("q"));
  const assignee = url.searchParams.get("assignee");
  const assigneeFilter = String(assignee || "").trim();
  const reason = cleanSearch(url.searchParams.get("reason"));
  const includesQuery = (row) => {
    if (!query) return true;
    const text = [row.handle, row.seller_name, row.seller_id, row.profile_url, row.reason, row.source, row.excluded_by, row.assignee]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(query.toLowerCase());
  };

  let handles = [];
  try {
    handles = await supabaseFetch(`${EXCLUDED_TABLE}?select=*&order=created_at.desc&limit=10000`, {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
  }

  const candidateParams = new URLSearchParams();
  candidateParams.set("select", "id,seller_name,seller_id,profile_url,profile_email,profile_image_url,review_status,dm_available,dm_status,email_status,assignee,memo,notes,status_updated_at,updated_at");
  candidateParams.set("review_status", `eq.${REVIEW_STATUSES[3]}`);
  candidateParams.set("order", "status_updated_at.desc,updated_at.desc");
  candidateParams.set("limit", "10000");
  if (assignee) candidateParams.set("assignee", `eq.${assignee}`);
  const excludedCandidates = await supabaseFetch(`${TABLE}?${candidateParams.toString()}`, {
    headers: { accept: "application/json" },
  });

  const scopedExcludedCandidates = reason ? [] : (excludedCandidates || []);
  const candidateHandles = new Set(scopedExcludedCandidates.map((row) => normalizeHandleFromRow(row)).filter(Boolean));
  const handleRows = (handles || [])
    .filter((row) => reason || row.reason !== "out_of_follower_range")
    .filter((row) => !reason || row.reason === reason)
    .filter((row) => {
      if (!assigneeFilter) return true;
      const excludedBy = String(row.excluded_by || "").trim();
      return excludedBy === assigneeFilter || !excludedBy || excludedBy === "crawler" || excludedBy.startsWith("crawler_");
    })
    .filter((row) => !candidateHandles.has(normalizeInstagramHandle(row.handle)))
    .map((row) => ({
      id: `excluded-${row.id}`,
      seller_name: row.handle,
      seller_id: row.handle,
      profile_url: row.handle ? `https://www.instagram.com/${normalizeInstagramHandle(row.handle)}/` : "",
      profile_email: "",
      dm_available: "",
      review_status: "제외",
      dm_status: "",
      email_status: "",
      assignee: row.excluded_by || "",
      excluded_reason: row.reason || "",
      excluded_source: row.source || "",
      status_updated_at: row.created_at,
      is_excluded_handle: true,
    }));

  return [
    ...scopedExcludedCandidates.map((row) => ({
      ...row,
      excluded_reason: row.memo || row.notes || "candidate_review_excluded",
      excluded_source: "beauty_seller_candidates",
      is_excluded_handle: false,
    })),
    ...handleRows,
  ].filter(includesQuery);
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

function removeKnownMissingColumns(columns) {
  return columns.filter((name) => !missingColumns.has(name));
}

function cleanSelectColumns(selectColumns) {
  if (selectColumns === "*") return selectColumns;
  return removeKnownMissingColumns(selectColumns.split(",")).join(",");
}

function isSentCompleteRow(row) {
  return normalizeDmStatus(row.dm_status) === DM_STATUSES[1] || ["발송완료", "미회신"].includes(row.email_status);
}

function isReplyCompleteRow(row) {
  const normalizedDmStatus = normalizeDmStatus(row.dm_status);
  const replyStatuses = ["답장옴", "거절", "보류"];
  return replyStatuses.includes(normalizedDmStatus) || replyStatuses.includes(row.email_status);
}

async function queryCandidates(url, options = {}) {
  const params = url.searchParams;
  let orColumns = removeKnownMissingColumns([...options.orColumns]);
  const order = options.order || "grade.desc,combination_score.desc,beauty_score.desc,total_comments.desc";
  const grade = options.hasOwnProperty("grade") ? options.grade : params.get("grade");
  const reviewStatus = options.hasOwnProperty("reviewStatus") ? options.reviewStatus : params.get("review_status");
  const reviewStatusIn = options.hasOwnProperty("reviewStatusIn") ? options.reviewStatusIn : params.get("review_status_in");
  const dmStatus = options.hasOwnProperty("dmStatus") ? options.dmStatus : params.get("dm_status");
  const dmStatusIn = options.hasOwnProperty("dmStatusIn") ? options.dmStatusIn : params.get("dm_status_in");
  const emailStatus = options.hasOwnProperty("emailStatus") ? options.emailStatus : params.get("email_status");
  const emailStatusIn = options.hasOwnProperty("emailStatusIn") ? options.emailStatusIn : params.get("email_status_in");
  const assignee = options.hasOwnProperty("assignee") ? options.assignee : params.get("assignee");
  const unassigned = options.hasOwnProperty("unassigned") ? options.unassigned : params.get("unassigned") === "1";
  const sentComplete = options.hasOwnProperty("sentComplete") ? options.sentComplete : params.get("sent_complete") === "1";
  const replyComplete = options.hasOwnProperty("replyComplete") ? options.replyComplete : params.get("reply_complete") === "1";
  const includeExcluded = options.hasOwnProperty("includeExcluded")
    ? options.includeExcluded
    : params.get("include_excluded") === "1";
  const requestedManageTab = options.hasOwnProperty("manageTab") ? options.manageTab : params.get("manage_tab");
  const rowLimit = options.hasOwnProperty("rowLimit")
    ? options.rowLimit
    : params.get("row_limit");

  const selectColumns = cleanSelectColumns(options.selectColumns || "*");
  const queries = searchTerms(params.get("q"));

  const apiParams = new URLSearchParams();
  apiParams.set("select", selectColumns);
  apiParams.set("order", order);
  const parsedRowLimit = Number(rowLimit);
  const fallbackLimit = sentComplete || replyComplete ? 2000 : 500;
  apiParams.set("limit", Number.isFinite(parsedRowLimit) && parsedRowLimit > 0 ? String(Math.round(parsedRowLimit)) : String(fallbackLimit));
  if (grade) apiParams.set("grade", `eq.${grade}`);
  const normalizedReviewStatuses = (() => {
    const values = String(reviewStatusIn || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => REVIEW_STATUSES.includes(value));
    if (values.length) return values;
    return reviewStatus ? [reviewStatus] : [];
  })();
  if (normalizedReviewStatuses.length) {
    if (normalizedReviewStatuses.length === 1) {
      apiParams.set("review_status", `eq.${normalizedReviewStatuses[0]}`);
    } else {
      apiParams.set(
        "review_status",
        `in.(${normalizedReviewStatuses.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")})`
      );
    }
  } else if (reviewStatus) {
    apiParams.set("review_status", `eq.${reviewStatus}`);
  }
  if (dmStatusIn) {
    const values = [...new Set(String(dmStatusIn)
      .split(",")
      .flatMap((value) => expandDmStatusForFilter(value.trim()))
      .filter(Boolean))];
    if (values.length) apiParams.set("dm_status", `in.(${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")})`);
  } else if (dmStatus) {
    const values = expandDmStatusForFilter(dmStatus);
    if (values.length === 1) {
      apiParams.set("dm_status", `eq.${values[0]}`);
    } else if (values.length > 1) {
      apiParams.set("dm_status", `in.(${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")})`);
    }
  }
  if (emailStatusIn) {
    const values = String(emailStatusIn)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length) apiParams.set("email_status", `in.(${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")})`);
  } else if (emailStatus) {
    apiParams.set("email_status", `eq.${emailStatus}`);
  }
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
    const visibleRows = replyComplete
      ? rows.filter(isReplyCompleteRow)
      : sentComplete
        ? rows.filter((row) => isSentCompleteRow(row))
        : rows;
    const isManageTab = ["pending", "pending-dm", "pending-email", "sent", "replied", "rejected", "excluded"].includes(requestedManageTab || "");
    const isExcludedManageTab = requestedManageTab === "rejected" || requestedManageTab === "excluded";
    const filteredRows = isManageTab && !isExcludedManageTab && reviewStatus !== REVIEW_STATUSES[3]
      ? visibleRows.filter((row) => row.review_status === REVIEW_STATUSES[1])
      : visibleRows;
    const hasExcludedInFilter = normalizedReviewStatuses.includes(REVIEW_STATUSES[3]);
    const nonExcludedRows = hasExcludedInFilter
      ? filteredRows
      : filteredRows.filter((row) => row.review_status !== REVIEW_STATUSES[3]);

    if (!includeExcluded) {
      const excluded = await listExcludedHandles();
      return nonExcludedRows.filter((row) =>
        hasExcludedInFilter && row.review_status === REVIEW_STATUSES[3]
          ? true
          : !excluded.has(normalizeHandleFromRow(row))
      );
    }

    return nonExcludedRows;
  } catch (error) {
    const missing = parseMissingColumn(error);
    if (missing) {
      missingColumns.add(missing);
      if (missing === "grade" && grade) {
        return queryCandidates(url, { ...options, grade: null });
      }
      if (missing === "review_status" && reviewStatus) {
        return queryCandidates(url, { ...options, reviewStatus: null });
      }
      if (missing === "review_status" && reviewStatusIn) {
        return queryCandidates(url, { ...options, reviewStatusIn: null });
      }
      if (missing === "dm_status" && (dmStatus || dmStatusIn)) {
        return queryCandidates(url, { ...options, dmStatus: null, dmStatusIn: null });
      }
      if (missing === "email_status" && (emailStatus || emailStatusIn)) {
        return [];
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
    "profile_email",
    "profile_image_url",
    "matched_hashtags",
    "prospect_personas",
    "prospect_signal_tags",
    "matched_prospect_keywords",
    "beauty_anchor_tags",
    "commercial_signal_tags",
    "format_signal_tags",
    "sample_post_urls",
    "engagement_posts",
    "notes",
    "memo",
  ];

  try {
    return await queryCandidates(url, {
      order: "grade.desc,prospect_score.desc,combination_score.desc,beauty_score.desc,total_comments.desc",
      orColumns: initialOrColumns,
      selectColumns: "id,seller_name,seller_id,profile_url,profile_email,profile_image_url,grade,matched_hashtags,category,beauty_score,selling_score,negative_score,combination_score,prospect_score,prospect_noise_score,prospect_personas,prospect_signal_tags,matched_prospect_keywords,prospect_noise_keywords,total_likes,total_comments,avg_likes,avg_comments,follower_count,beauty_anchor_tags,commercial_signal_tags,format_signal_tags,engagement_rate,engagement_post_count,engagement_posts,engagement_refresh_error,last_engagement_refresh_at,review_status,dm_available,dm_status,email_status,brand_fit,groupbuy_experience,agency_status,assignee,memo,sample_post_urls,notes,status_updated_by,status_updated_at,last_contacted_at,last_emailed_at,last_replied_at,updated_at",
    });
  } catch (error) {
    const missing = parseMissingColumn(error);
    if (missing) {
      return queryCandidates(url, {
        order: "grade.desc,combination_score.desc,beauty_score.desc,total_comments.desc",
        orColumns: ["seller_name", "seller_id", "profile_url", "profile_email", "notes", "memo"],
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
  const sellerId = normalizeSellerId(patch.seller_id || patch.handle || patch.profile_url);
  const sellerName = String(patch.seller_name || sellerId || "").trim().replace(/^@/, "");
  if (!sellerName) {
    const error = new Error("seller_name is required.");
    error.status = 400;
    throw error;
  }
  if (!sellerId) {
    const error = new Error("seller_id is required.");
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
    profile_email: patch.profile_email || null,
    profile_image_url: patch.profile_image_url || null,
    category: patch.category || null,
    follower_count: toInteger(patch.follower_count),
    avg_likes: toInteger(patch.avg_likes),
    avg_comments: toInteger(patch.avg_comments),
    engagement_rate: toNumberOrNull(patch.engagement_rate),
    review_status: patch.review_status || REVIEW_STATUSES[0],
    dm_status: normalizeDmStatus(patch.dm_status),
    email_status: patch.email_status || EMAIL_STATUSES[0],
    brand_fit: patch.brand_fit || null,
    groupbuy_experience: normalizeWithAllowed(patch.groupbuy_experience, GROUPBUY_EXPERIENCE_VALUES),
    agency_status: normalizeAgencyStatus(patch.agency_status),
    assignee: patch.assignee || null,
    memo: patch.memo || null,
    notes: patch.notes || null,
    status_updated_by: String(actor || patch.assignee || "").trim() || "unknown",
    status_updated_at: now,
  };

  return supabaseFetch(`${TABLE}?on_conflict=seller_id`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(body),
  });
}

export async function updateCandidate(id, patch, actor) {
  const blocked = new Set(["id", "actor", "created_at", "updated_at"]);
  const body = Object.fromEntries(
    Object.entries(patch)
      .filter(([key]) => !blocked.has(key))
      .map(([key, value]) => [key, value === undefined ? null : value])
  );
  if (Object.prototype.hasOwnProperty.call(body, "groupbuy_experience")) {
    body.groupbuy_experience = normalizeWithAllowed(body.groupbuy_experience, GROUPBUY_EXPERIENCE_VALUES);
  }
  if (Object.prototype.hasOwnProperty.call(body, "agency_status")) {
    body.agency_status = normalizeAgencyStatus(body.agency_status);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dm_status")) {
    body.dm_status = normalizeDmStatus(body.dm_status);
  }

  if (!Object.keys(body).length) return null;

  const now = new Date().toISOString();
  body.status_updated_by = String(actor || "").trim() || "unknown";
  body.status_updated_at = now;
  const normalizedDmStatus = normalizeDmStatus(body.dm_status);
  if (normalizedDmStatus === DM_STATUSES[1] || normalizedDmStatus === DM_STATUSES[2]) {
    body.last_contacted_at = now;
  }
  if (body.email_status === EMAIL_STATUSES[1]) {
    body.last_emailed_at = now;
    body.last_contacted_at = now;
  }
  if (body.email_status === EMAIL_STATUSES[2]) {
    body.last_contacted_at = now;
  }
  if (normalizedDmStatus === DM_STATUSES[2] || body.email_status === EMAIL_STATUSES[2]) {
    body.last_replied_at = now;
  }
  const markAsExcluded = body.review_status === "제외";

  const updated = await supabaseFetch(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const row = Array.isArray(updated) ? updated[0] : null;
  if (markAsExcluded && row) {
    await upsertExcludedHandle(normalizeHandleFromRow(row), {
      reason: "manual_review_excluded",
      source: "review_app",
      excludedBy: body.status_updated_by,
    });
  } else if (body.review_status && row) {
    await deleteExcludedHandle(normalizeHandleFromRow(row));
  }
  return updated;
}

function templateContext(row) {
  const account = normalizeInstagramHandle(row?.seller_id || row?.profile_url || row?.seller_name || "") || String(row?.seller_name || "").trim();
  const personalized = row?.personalized_context && typeof row.personalized_context === "object" ? row.personalized_context : {};
  return {
    account,
    name: String(personalized.name || row?.seller_name || account || "").trim(),
    email: String(row?.profile_email || row?.email || "").trim(),
    profile_url: row?.profile_url || (account ? `https://www.instagram.com/${account}/` : ""),
    product_name: personalized.product_name || row?.product_name || "",
    recent_content_note: personalized.recent_content_note || row?.recent_content_note || "",
    fit_reason: personalized.fit_reason || row?.fit_reason || "",
    custom_note: personalized.custom_note || row?.custom_note || "",
    reply_deadline: personalized.reply_deadline || row?.reply_deadline || "",
    launch_date: personalized.launch_date || row?.launch_date || "",
    offer: personalized.offer || row?.offer || "",
    schedule: personalized.schedule || row?.schedule || "",
  };
}

function containsHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function renderTemplate(template, row, extraContext = {}) {
  const context = { ...templateContext(row), ...extraContext };
  const htmlMode = containsHtml(template);
  return String(template || "").replace(
    /\{\{\s*(account|name|email|profile_url|product_name|recent_content_note|fit_reason|custom_note|reply_deadline|launch_date|offer|schedule)\s*\}\}/g,
    (_, key) => htmlMode ? escapeHtml(context[key] || "") : context[key] || ""
  );
}

function defaultPersonalizedContext(row) {
  const signals = [
    row?.brand_fit ? `브랜드 핏 ${row.brand_fit}` : "",
    row?.prospect_signal_tags,
    row?.matched_prospect_keywords,
  ].filter(Boolean);
  return {
    name: String(row?.seller_name || "").trim(),
    product_name: "",
    recent_content_note: "",
    fit_reason: signals.slice(0, 2).join(" · "),
    custom_note: row?.memo || row?.notes || "",
    reply_deadline: "",
    launch_date: "6월 20일",
    offer: "",
  };
}

function campaignRenderContext(campaign, row) {
  const context = templateContext(row);
  const schedule = renderTemplate(campaign.schedule_template || "", row, context);
  return { ...context, schedule };
}

function renderCampaignSubject(campaign, row) {
  return renderTemplate(campaign.subject_template, row, campaignRenderContext(campaign, row));
}

function renderCampaignBody(campaign, row) {
  return renderTemplate(campaign.body_template, row, campaignRenderContext(campaign, row));
}

function campaignSchemaError() {
  const error = new Error("outreach campaign schema is not ready. Run supabase_schema.sql first.");
  error.status = 400;
  return error;
}

function campaignSummary(campaign, recipients = []) {
  const counts = recipients.reduce(
    (acc, row) => {
      const status = row.send_status || "pending";
      acc[status] = (acc[status] || 0) + 1;
      if (row.replied) acc.replied += 1;
      return acc;
    },
    { total: recipients.length, sent: 0, pending: 0, error: 0, skipped_missing_email: 0, replied: 0 }
  );
  return { ...campaign, counts };
}

export async function listCampaigns() {
  try {
    const campaigns = await supabaseFetch(`${CAMPAIGNS_TABLE}?select=*&order=created_at.desc&limit=100`, {
      headers: { accept: "application/json" },
    });
    if (!campaigns?.length) return [];
    const ids = campaigns.map((row) => row.id).join(",");
    const recipients = await supabaseFetch(`${RECIPIENTS_TABLE}?select=id,campaign_id,send_status,replied&campaign_id=in.(${ids})&limit=10000`, {
      headers: { accept: "application/json" },
    });
    return campaigns.map((campaign) => campaignSummary(campaign, recipients.filter((row) => Number(row.campaign_id) === Number(campaign.id))));
  } catch (error) {
    if (isMissingCampaignSchema(error)) throw campaignSchemaError();
    throw error;
  }
}

export async function createCampaign(patch, actor) {
  const now = new Date().toISOString();
  const name = String(patch.name || "").trim();
  if (!name) {
    const error = new Error("campaign name is required.");
    error.status = 400;
    throw error;
  }
  try {
    return supabaseFetch(`${CAMPAIGNS_TABLE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify({
        name,
        sender_email: patch.sender_email || env.gmailSenderEmail || null,
        sender_name: patch.sender_name || env.gmailSenderName || null,
        subject_template: patch.subject_template || "",
        body_template: patch.body_template || "",
        status: patch.status || "draft",
        created_by: String(actor || patch.created_by || "").trim() || "unknown",
        created_at: now,
        updated_at: now,
      }),
    });
  } catch (error) {
    if (isMissingCampaignSchema(error)) throw campaignSchemaError();
    throw error;
  }
}

export async function getCampaign(id) {
  try {
    const campaigns = await supabaseFetch(`${CAMPAIGNS_TABLE}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, {
      headers: { accept: "application/json" },
    });
    const campaign = campaigns?.[0];
    if (!campaign) {
      const error = new Error("campaign not found.");
      error.status = 404;
      throw error;
    }
    const recipients = await supabaseFetch(`${RECIPIENTS_TABLE}?select=*&campaign_id=eq.${encodeURIComponent(id)}&order=created_at.asc&limit=2000`, {
      headers: { accept: "application/json" },
    });
    const messages = await supabaseFetch(`${MESSAGES_TABLE}?select=*&campaign_id=eq.${encodeURIComponent(id)}&order=message_at.asc&limit=5000`, {
      headers: { accept: "application/json" },
    });
    return { ...campaignSummary(campaign, recipients || []), recipients: recipients || [], messages: messages || [] };
  } catch (error) {
    if (isMissingCampaignSchema(error)) throw campaignSchemaError();
    throw error;
  }
}

export async function updateCampaign(id, patch) {
  const allowed = new Set(["name", "sender_email", "sender_name", "subject_template", "body_template", "status"]);
  const body = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
  if (!Object.keys(body).length) return getCampaign(id);
  try {
    await supabaseFetch(`${CAMPAIGNS_TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
    return getCampaign(id);
  } catch (error) {
    if (isMissingCampaignSchema(error)) throw campaignSchemaError();
    throw error;
  }
}

export async function deleteCampaign(id) {
  try {
    await getCampaign(id);
    await supabaseFetch(`${CAMPAIGNS_TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { prefer: "return=minimal" },
    });
    return { ok: true, id: Number(id) || id };
  } catch (error) {
    if (isMissingCampaignSchema(error)) throw campaignSchemaError();
    throw error;
  }
}

async function fetchCandidatesByIds(ids) {
  if (!ids.length) return [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 120) {
    const batch = ids.slice(i, i + 120).map((id) => Number(id)).filter(Boolean);
    if (!batch.length) continue;
    const rows = await supabaseFetch(
      `${TABLE}?select=id,seller_name,seller_id,profile_url,profile_email,profile_image_url,dm_status,email_status,review_status,groupbuy_experience,agency_status,assignee&id=in.(${batch.join(",")})&limit=500`,
      { headers: { accept: "application/json" } }
    );
    chunks.push(...(rows || []));
  }
  return chunks;
}

export async function addCampaignRecipients(id, patch) {
  const campaign = await getCampaign(id);
  const candidateIds = [...new Set((patch.candidate_ids || patch.candidateIds || []).map((value) => Number(value)).filter(Boolean))];
  if (!candidateIds.length) {
    const error = new Error("candidate_ids is required.");
    error.status = 400;
    throw error;
  }
  const existing = new Set((campaign.recipients || []).map((row) => Number(row.candidate_id)).filter(Boolean));
  const candidates = (await fetchCandidatesByIds(candidateIds))
    .filter((row) => !existing.has(Number(row.id)))
    .filter((row) => !isSentCompleteRow(row) && !isReplyCompleteRow(row));
  const emailOverrides = patch.recipient_emails || patch.recipientEmails || {};
  const body = candidates.map((row) => {
    const context = templateContext(row);
    const email = String(emailOverrides[row.id] || row.profile_email || "").trim();
    const personalizedContext = defaultPersonalizedContext(row);
    const renderRow = { ...row, profile_email: email || row.profile_email, personalized_context: personalizedContext };
    return {
      campaign_id: Number(id),
      candidate_id: Number(row.id),
      send_channel: "email",
      email: email || null,
      account: context.account || null,
      name: context.name || null,
      profile_url: context.profile_url || null,
      profile_image_url: row.profile_image_url || null,
      personalized_subject: renderCampaignSubject(campaign, renderRow),
      personalized_body: renderCampaignBody(campaign, renderRow),
      personalized_context: personalizedContext,
      send_status: email ? "pending" : "skipped_missing_email",
      error_message: email ? null : "profile_email is empty",
    };
  });
  if (body.length) {
    await supabaseFetch(`${RECIPIENTS_TABLE}?on_conflict=campaign_id,candidate_id`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(body),
    });
  }
  return getCampaign(id);
}

export async function updateCampaignRecipient(campaignId, recipientId, patch) {
  const campaign = await getCampaign(campaignId);
  const recipient = (campaign.recipients || []).find((row) => Number(row.id) === Number(recipientId));
  if (!recipient) {
    const error = new Error("recipient not found.");
    error.status = 404;
    throw error;
  }

  const currentContext = recipient.personalized_context && typeof recipient.personalized_context === "object" ? recipient.personalized_context : {};
  const nextContext = {
    ...currentContext,
    ...(patch.personalized_context && typeof patch.personalized_context === "object" ? patch.personalized_context : {}),
  };
  const nextRecipient = {
    ...recipient,
    seller_id: recipient.account,
    seller_name: recipient.name,
    profile_email: patch.email ?? recipient.email,
    profile_url: recipient.profile_url,
    personalized_context: nextContext,
  };
  const body = {
    personalized_context: nextContext,
    personalized_subject: patch.personalized_subject ?? renderCampaignSubject(campaign, nextRecipient),
    personalized_body: patch.personalized_body ?? renderCampaignBody(campaign, nextRecipient),
    updated_at: new Date().toISOString(),
  };
  if (Object.prototype.hasOwnProperty.call(patch, "email")) {
    body.email = String(patch.email || "").trim() || null;
    if (!body.email) {
      body.send_status = "skipped_missing_email";
      body.error_message = "profile_email is empty";
    } else if (recipient.send_status === "skipped_missing_email") {
      body.send_status = "pending";
      body.error_message = null;
    }
  }
  await patchRecipient(recipientId, body);
  return getCampaign(campaignId);
}

function assertGmailConfigured() {
  if (!env.gmailClientId || !env.gmailClientSecret || !env.gmailRefreshToken || !env.gmailSenderEmail) {
    const error = new Error("Gmail API env is required: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER_EMAIL.");
    error.status = 400;
    throw error;
  }
}

async function gmailClient() {
  assertGmailConfigured();
  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.OAuth2(env.gmailClientId, env.gmailClientSecret);
    auth.setCredentials({ refresh_token: env.gmailRefreshToken });
    const gmail = google.gmail({ version: "v1", auth });
    return {
      async send(raw) {
        const result = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw },
        });
        return result.data;
      },
      async thread(id) {
        const result = await gmail.users.threads.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        return result.data;
      },
    };
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" && !/Cannot find package 'googleapis'/.test(String(error.message || ""))) throw error;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.gmailClientId,
        client_secret: env.gmailClientSecret,
        refresh_token: env.gmailRefreshToken,
        grant_type: "refresh_token",
      }),
    });
    const tokenText = await tokenResponse.text();
    if (!tokenResponse.ok) throw new Error(`Gmail token refresh failed: ${tokenText}`);
    const token = JSON.parse(tokenText).access_token;
    const gmailFetch = async (path, options = {}) => {
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        ...options,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text || "Gmail request failed");
      return text ? JSON.parse(text) : null;
    };
    return {
      send(raw) {
        return gmailFetch("messages/send", { method: "POST", body: JSON.stringify({ raw }) });
      },
      thread(id) {
        const params = new URLSearchParams({
          format: "metadata",
          metadataHeaders: "From",
        });
        params.append("metadataHeaders", "Subject");
        params.append("metadataHeaders", "Date");
        return gmailFetch(`threads/${encodeURIComponent(id)}?${params.toString()}`);
      },
    };
  }
}

function encodeMimeWord(value) {
  const text = String(value || "");
  return /[^\x20-\x7E]/.test(text) ? `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=` : text;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function mailAddress(name, email) {
  const cleanEmail = String(email || "").trim();
  const cleanName = String(name || "").trim();
  return cleanName ? `${encodeMimeWord(cleanName)} <${cleanEmail}>` : cleanEmail;
}

async function sendGmailMessage(gmail, { fromName, fromEmail, to, subject, body }) {
  const isHtml = containsHtml(body);
  const raw = [
    `From: ${mailAddress(fromName, fromEmail)}`,
    `To: ${to}`,
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: ${isHtml ? "text/html" : "text/plain"}; charset=UTF-8`,
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
  return gmail.send(base64Url(raw));
}

async function patchRecipient(id, body) {
  return supabaseFetch(`${RECIPIENTS_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
}

async function insertOutreachMessage(body) {
  return supabaseFetch(`${MESSAGES_TABLE}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
}

export async function sendCampaign(id) {
  const campaign = await getCampaign(id);
  const gmail = await gmailClient();
  const now = new Date().toISOString();
  const summary = { sent: 0, skipped: 0, failed: 0 };
  for (const recipient of campaign.recipients || []) {
    if (recipient.send_status === "sent" || recipient.send_status === "replied") {
      summary.skipped += 1;
      continue;
    }
    if (!recipient.email) {
      await patchRecipient(recipient.id, { send_status: "skipped_missing_email", error_message: "profile_email is empty" });
      summary.skipped += 1;
      continue;
    }
    const rowContext = {
      seller_id: recipient.account,
      seller_name: recipient.name,
      profile_url: recipient.profile_url,
      profile_email: recipient.email,
      personalized_context: recipient.personalized_context || {},
    };
    const subject = renderCampaignSubject(campaign, rowContext) || recipient.personalized_subject || campaign.name;
    const body = renderCampaignBody(campaign, rowContext) || recipient.personalized_body || "";
    try {
      const sent = await sendGmailMessage(gmail, {
        fromName: campaign.sender_name || env.gmailSenderName,
        fromEmail: campaign.sender_email || env.gmailSenderEmail,
        to: recipient.email,
        subject,
        body,
      });
      await patchRecipient(recipient.id, {
        personalized_subject: subject,
        personalized_body: body,
        send_status: "sent",
        gmail_message_id: sent.id || null,
        gmail_thread_id: sent.threadId || null,
        error_message: null,
        last_sent_at: now,
      });
      await insertOutreachMessage({
        campaign_id: Number(id),
        recipient_id: recipient.id,
        candidate_id: recipient.candidate_id,
        direction: "sent",
        subject,
        body_snippet: body.slice(0, 500),
        gmail_message_id: sent.id || null,
        gmail_thread_id: sent.threadId || null,
        message_at: now,
      });
      if (recipient.candidate_id) {
        await updateCandidate(recipient.candidate_id, { email_status: EMAIL_STATUSES[1] }, "campaign_send");
      }
      summary.sent += 1;
    } catch (error) {
      await patchRecipient(recipient.id, {
        personalized_subject: subject,
        personalized_body: body,
        send_status: "error",
        error_message: String(error.message || "gmail send failed").slice(0, 500),
      });
      summary.failed += 1;
    }
  }
  await supabaseFetch(`${CAMPAIGNS_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({ status: "sent", last_sent_at: now }),
  });
  return { ...summary, campaign: await getCampaign(id) };
}

function gmailHeader(message, name) {
  return message?.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

export async function syncCampaignReplies(id) {
  const campaign = await getCampaign(id);
  const gmail = await gmailClient();
  const sender = String(campaign.sender_email || env.gmailSenderEmail || "").toLowerCase();
  const now = new Date().toISOString();
  const summary = { checked: 0, replied: 0, failed: 0 };
  const sentRecipients = (campaign.recipients || []).filter((row) => row.gmail_thread_id && row.send_status === "sent");
  for (const recipient of sentRecipients) {
    summary.checked += 1;
    try {
      const thread = await gmail.thread(recipient.gmail_thread_id);
      const replies = (thread.messages || []).filter((message) => {
        if (message.id === recipient.gmail_message_id) return false;
        const from = gmailHeader(message, "From").toLowerCase();
        return from && !from.includes(sender);
      });
      if (!replies.length) continue;
      const latest = replies.at(-1);
      const subject = gmailHeader(latest, "Subject") || recipient.personalized_subject || campaign.subject_template;
      const messageAt = latest.internalDate ? new Date(Number(latest.internalDate)).toISOString() : now;
      await patchRecipient(recipient.id, {
        replied: true,
        send_status: "replied",
        last_replied_at: messageAt,
        error_message: null,
      });
      await insertOutreachMessage({
        campaign_id: Number(id),
        recipient_id: recipient.id,
        candidate_id: recipient.candidate_id,
        direction: "received",
        subject,
        body_snippet: latest.snippet || "",
        gmail_message_id: latest.id || null,
        gmail_thread_id: recipient.gmail_thread_id,
        message_at: messageAt,
      });
      if (recipient.candidate_id) {
        await updateCandidate(recipient.candidate_id, { email_status: EMAIL_STATUSES[2] }, "campaign_reply_sync");
      }
      summary.replied += 1;
    } catch (error) {
      await patchRecipient(recipient.id, { error_message: String(error.message || "gmail sync failed").slice(0, 500) });
      summary.failed += 1;
    }
  }
  await supabaseFetch(`${CAMPAIGNS_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({ last_synced_at: now }),
  });
  return { ...summary, campaign: await getCampaign(id) };
}

async function fetchStatsRows(selectColumns) {
  const cleanedColumns = cleanSelectColumns(selectColumns);
  try {
    return await supabaseFetch(
      `${TABLE}?select=${cleanedColumns}&limit=10000`,
      { headers: { accept: "application/json" } }
    );
  } catch (error) {
    const missing = parseMissingColumn(error);
    if (missing && cleanedColumns.includes(missing)) {
      missingColumns.add(missing);
      const nextColumns = removeColumn(cleanedColumns.split(","), missing).join(",");
      return fetchStatsRows(nextColumns);
    }
    throw error;
  }
}

export async function stats() {
  const rows = await fetchStatsRows("grade,review_status,dm_status,email_status,assignee,combination_score");
  const countBy = (key) =>
    rows.reduce((acc, row) => {
      const value = row[key] || "\uC5C6\uC74C";
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

  return {
    total: rows.length,
    sendable: rows.filter((row) => row.review_status === REVIEW_STATUSES[1] && (row.dm_status === DM_STATUSES[0] || row.email_status === EMAIL_STATUSES[0])).length,
    dmSent: rows.filter((row) => normalizeDmStatus(row.dm_status) === DM_STATUSES[1]).length,
    dmReplies: rows.filter((row) => normalizeDmStatus(row.dm_status) === DM_STATUSES[2]).length,
    emailSent: rows.filter((row) => row.email_status === EMAIL_STATUSES[1]).length,
    emailReplies: rows.filter((row) => row.email_status === EMAIL_STATUSES[2]).length,
    byGrade: countBy("grade"),
    byReviewStatus: countBy("review_status"),
    byDmStatus: countBy("dm_status"),
    byEmailStatus: countBy("email_status"),
    byAssignee: countBy("assignee"),
    assignees: [...new Set(rows.map((row) => row.assignee).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
  };
}

export function handleError(response, error) {
  sendJson(response, error.status || 500, { error: error.message || "\uC11C\uBC84 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4." });
}
