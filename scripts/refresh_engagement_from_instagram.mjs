import { readSupabaseEnv } from "./supabase_env.mjs";


const TABLE = "beauty_seller_candidates";
const DEFAULT_INTERVAL_MS = 8000;
const DEFAULT_MAX_POSTS = 20;
const USER_FEED_ENDPOINT = "https://i.instagram.com/api/v1/feed/user";
const WEB_PROFILE_ENDPOINT = "https://i.instagram.com/api/v1/users/web_profile_info/";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    limit: 80,
    maxPosts: DEFAULT_MAX_POSTS,
    intervalMs: DEFAULT_INTERVAL_MS,
    cookie: "",
    onlyWithSellerId: true,
    includeWithoutSellerId: false,
    sellerName: "",
    onlyMissingFollowers: false,
    onlyMissingEr: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--max-posts") args.maxPosts = Number(argv[++i]);
    else if (arg === "--interval-ms") args.intervalMs = Number(argv[++i]);
    else if (arg === "--cookie") args.cookie = argv[++i];
    else if (arg === "--all") args.onlyWithSellerId = false;
    else if (arg === "--with-fallback") args.includeWithoutSellerId = true;
    else if (arg === "--seller" || arg === "--seller-name") args.sellerName = String(argv[++i] || "").trim();
    else if (arg === "--only-missing-followers") args.onlyMissingFollowers = true;
    else if (arg === "--only-missing-er") args.onlyMissingEr = true;
  }

  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 80;
  if (!Number.isFinite(args.maxPosts) || args.maxPosts <= 0) args.maxPosts = DEFAULT_MAX_POSTS;
  if (!Number.isFinite(args.intervalMs) || args.intervalMs < 0) args.intervalMs = DEFAULT_INTERVAL_MS;

  return args;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toUtf8B64(value) {
  return `b64:${Buffer.from(String(value || ""), "utf8").toString("base64")}`;
}

function parseFollowerFromMeta(value) {
  const num = Number(
    String(value || "")
      .replace(/,/g, "")
      .replace(/[^\d.]/g, "")
  );
  return Number.isFinite(num) ? Math.floor(num) : 0;
}

function buildSupabaseHeaders(env) {
  return {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
  };
}

async function fetchSupabaseRows(env, args) {
  const columnSets = [
    ["id", "seller_name", "seller_id", "profile_url", "sample_post_urls", "total_likes", "total_comments", "follower_count", "avg_likes", "avg_comments", "engagement_rate", "engagement_post_count"],
    ["id", "seller_name", "seller_id", "profile_url", "sample_post_urls", "total_likes", "total_comments", "follower_count", "engagement_rate", "engagement_post_count"],
    ["id", "seller_name", "profile_url", "sample_post_urls", "total_likes", "total_comments", "follower_count", "engagement_rate", "engagement_post_count"],
    ["id", "seller_name", "seller_id", "profile_url", "sample_post_urls", "total_likes", "total_comments"],
    ["id", "seller_name", "profile_url", "sample_post_urls", "total_likes", "total_comments"],
  ];
  const orderColumns = ["last_engagement_refresh_at.asc.nullsfirst,id.asc", "id.asc", ""];

  let lastError;
  for (const columns of columnSets) {
    for (const orderClause of orderColumns) {
      const params = new URLSearchParams();
      params.set("select", columns.join(","));
      if (orderClause) params.set("order", orderClause);
      params.set("limit", String(args.limit));

      if (args.sellerName) {
        params.set("seller_name", `eq.${args.sellerName}`);
      }

      if (args.onlyWithSellerId && !args.includeWithoutSellerId) {
        params.set("seller_id", "not.is.null");
      }
      if (args.onlyMissingFollowers && columns.includes("follower_count")) {
        params.set("or", "(follower_count.is.null,follower_count.eq.0)");
      }
      if (args.onlyMissingEr && columns.includes("engagement_rate")) {
        params.set("or", "(engagement_rate.is.null,engagement_rate.eq.0)");
      }
      const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?${params}`, {
        headers: buildSupabaseHeaders(env),
      });

      const text = await response.text();
      if (!response.ok) {
        lastError = `${response.status}: ${text}`;
        if (response.status === 400 && text.includes("does not exist")) {
          continue;
        }
        throw new Error(lastError);
      }

      return text ? JSON.parse(text) : [];
    }
  }

  throw new Error(lastError || "No selectable columns");
}

function parseMissingColumn(message) {
  const match = message.match(/column\s+(?:[^\s.]+\.)?([a-zA-Z0-9_]+)\s+does not exist/i);
  if (match && match[1]) return match[1];
  const quoted = message.match(/column "([^"]+)"/i);
  return quoted ? quoted[1] : null;
}

function normalizeHandle(profileUrl, sellerName) {
  if (sellerName) return normalizeText(sellerName).replace(/^@/, "").replace(/\/+$/, "");
  const match = /instagram\.com\/([^/?#]+)/i.exec(profileUrl || "");
  return match ? match[1] : "";
}

function instagramWebHeaders(cookie, referer = "https://www.instagram.com/") {
  const csrfToken = String(cookie.match(/csrftoken=([^;]+)/)?.[1] || "");
  return {
    accept: "*/*",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "x-ig-app-id": "936619743392459",
    "x-csrftoken": csrfToken,
    "x-requested-with": "XMLHttpRequest",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    referer,
    ...(cookie ? { cookie } : {}),
  };
}

function sumEngagement(posts) {
  const used = posts.filter((item) => item.likes >= 0 && item.comments >= 0);
  const engagement_post_count = used.length;
  const likes_sum = used.reduce((total, post) => total + post.likes, 0);
  const comments_sum = used.reduce((total, post) => total + post.comments, 0);
  const avg_likes = engagement_post_count ? Math.round(likes_sum / engagement_post_count) : 0;
  const avg_comments = engagement_post_count ? Math.round(comments_sum / engagement_post_count) : 0;
  return { used, engagement_post_count, likes_sum, comments_sum, avg_likes, avg_comments };
}

function calcRate(avgLikes, avgComments, followerCount) {
  if (followerCount <= 0) return 0;
  const avgPerPost = avgLikes + avgComments;
  return Number(((avgPerPost / followerCount) * 100).toFixed(4));
}

function splitPostUrls(row) {
  return normalizeText(row.sample_post_urls)
    .split("|")
    .map(normalizeText)
    .filter(Boolean);
}

async function fetchFromUserFeed(sellerId, maxPosts, cookie) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${USER_FEED_ENDPOINT}/${encodeURIComponent(sellerId)}/?count=${maxPosts}`, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Instagram 261.0.0.18.68",
        ...(cookie ? { cookie } : {}),
      },
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok || !json?.items) {
      return null;
    }

    const posts = json.items
      .slice(0, maxPosts)
      .map((item) => ({
        url: item.code ? `https://www.instagram.com/p/${item.code}/` : "",
        likes: toNumber(item.like_count),
        comments: toNumber(item.comment_count),
      }))
      .filter((item) => item.url);

    const followerCount = toNumber(
      json?.user?.follower_count ??
        json?.user?.edge_followed_by?.count ??
        json?.user?.edge_followed_by_count ??
        json?.user?.counts?.followed_by_count ??
        json?.graphql?.user?.edge_followed_by?.count
    );

    return { posts, followerCount };
  } finally {
    clearTimeout(timeout);
  }
}

function collectFromStoredMetrics(row) {
  const followerCount = toNumber(row.follower_count);
  const totalLikes = toNumber(row.total_likes);
  const totalComments = toNumber(row.total_comments);
  const postCount = Math.max(splitPostUrls(row).length, toNumber(row.engagement_post_count), 1);
  if (followerCount <= 0 || totalLikes + totalComments <= 0) return null;

  const avg_likes = Math.round(totalLikes / postCount);
  const avg_comments = Math.round(totalComments / postCount);
  return {
    follower_count: followerCount,
    avg_likes,
    avg_comments,
    engagement_post_count: postCount,
    engagement_rate: calcRate(avg_likes, avg_comments, followerCount),
    engagement_refresh_error: null,
    last_engagement_refresh_at: new Date().toISOString(),
  };
}

async function fetchFromWebProfile(username, maxPosts, cookie) {
  if (!username) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${WEB_PROFILE_ENDPOINT}?username=${encodeURIComponent(username)}`, {
      signal: controller.signal,
      headers: instagramWebHeaders(cookie, `https://www.instagram.com/${username}/`),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
    const user = json?.data?.user || json?.user;
    const edges = user?.edge_owner_to_timeline_media?.edges || [];
    const posts = edges
      .slice(0, maxPosts)
      .map((edge) => {
        const node = edge?.node || edge;
        const code = node?.shortcode || node?.code;
        return {
          url: code ? `https://www.instagram.com/p/${code}/` : "",
          likes: toNumber(node?.edge_liked_by?.count ?? node?.edge_media_preview_like?.count ?? node?.like_count),
          comments: toNumber(node?.edge_media_to_comment?.count ?? node?.edge_media_to_parent_comment?.count ?? node?.comment_count),
        };
      })
      .filter((item) => item.url);
    const followerCount = toNumber(user?.edge_followed_by?.count ?? user?.follower_count);
    if (!response.ok || (!posts.length && !followerCount)) return null;
    return { posts, followerCount };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFromProfileFallback(profileUrl, maxPosts, cookie) {
  if (!profileUrl) return null;
  const normalized = profileUrl || "";
  const url = `${normalized}${normalized.includes("?") ? "&" : "?"}__a=1&__d=dis`;
  const response = await fetch(url, {
    headers: instagramWebHeaders(cookie, normalized),
  });
  const text = await response.text();
  if (!response.ok) return null;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }

  const edges =
    json?.data?.user?.edge_owner_to_timeline_media?.edges ||
    json?.graphql?.user?.edge_owner_to_timeline_media?.edges ||
    [];
  const posts = edges
    .slice(0, maxPosts)
    .map((edge) => {
      const node = edge?.node;
      const code = node?.shortcode || node?.code;
      return {
        url: code ? `https://www.instagram.com/p/${code}/` : "",
        likes: toNumber(node?.edge_media_preview_like?.count || node?.likes?.count),
        comments: toNumber(node?.edge_media_to_parent_comment?.count || node?.comments?.count),
      };
    })
    .filter((item) => item.url);
  return posts.length ? posts : null;
}

function toProfileUrl(sellerId, profileUrl) {
  if (profileUrl) return profileUrl;
  if (!sellerId) return "";
  return `https://www.instagram.com/${sellerId}/`;
}

async function fetchPostSamplesFromUrls(postUrls, maxPosts, cookie) {
  const picked = postUrls.slice(0, maxPosts);
  const posts = [];
  for (const postUrl of picked) {
    try {
      const response = await fetch(postUrl + (postUrl.includes("?") ? "&" : "?") + "__a=1", {
        headers: instagramWebHeaders(cookie, postUrl),
      });
      const text = await response.text();
      if (!response.ok) continue;
      const media = JSON.parse(text);
      const node = media?.graphql?.shortcode_media || media?.data?.shortcode_media;
      if (!node) continue;

      posts.push({
        url: postUrl,
        likes: toNumber(node.edge_media_preview_like?.count ?? node?.edge_liked_by?.count ?? node?.likes?.count),
        comments: toNumber(node.edge_media_to_parent_comment?.count ?? node?.comments?.count),
      });
    } catch {
      continue;
    }
  }
  return posts;
}

async function collectForRow(row, args) {
  const maxPosts = args.maxPosts;
  let posts = null;
  let followerCount = toNumber(row.follower_count);
  const profileUrl = toProfileUrl(row.seller_id, row.profile_url);
  const username = normalizeHandle(profileUrl, row.seller_id || row.seller_name);

  if (!posts && username) {
    const webProfile = await fetchFromWebProfile(username, maxPosts, args.cookie);
    if (webProfile?.posts?.length) {
      posts = webProfile.posts;
    }
    if (!followerCount && webProfile?.followerCount) {
      followerCount = webProfile.followerCount;
    }
  }

  if (!followerCount && profileUrl) {
    const profileResponse = await fetchFromProfileFallback(profileUrl, maxPosts, args.cookie);
    if (profileResponse) {
      posts = profileResponse;
      const text = await fetch(profileUrl, {
        headers: instagramWebHeaders(args.cookie, profileUrl),
      }).then(async (res) => (res.ok ? res.text() : ""));
      const match = text.match(/"edge_followed_by":{"count":(\d+)/);
      followerCount = parseFollowerFromMeta(match?.[1]);
    }
  }

  if (!posts && row.seller_id) {
    const feedPosts = await fetchFromUserFeed(row.seller_id, maxPosts, args.cookie);
    if (feedPosts?.posts?.length) {
      posts = feedPosts.posts;
      if (!followerCount && feedPosts.followerCount) {
        followerCount = feedPosts.followerCount;
      }
    }
  }

  if (!posts && profileUrl) {
    const profilePosts = await fetchFromProfileFallback(profileUrl, maxPosts, args.cookie);
    posts = profilePosts;
  }

  if (!posts) {
    const fallbackFromSamples = await fetchPostSamplesFromUrls(splitPostUrls(row), maxPosts, args.cookie);
    posts = fallbackFromSamples;
  }

  if (!posts || !posts.length) {
    const stored = collectFromStoredMetrics({ ...row, follower_count: followerCount || row.follower_count });
    if (stored) return stored;
    if (followerCount > 0) {
      return {
        follower_count: followerCount,
        engagement_refresh_error: "recent posts not found",
        last_engagement_refresh_at: new Date().toISOString(),
      };
    }
    throw new Error("recent posts not found");
  }

  const { used, engagement_post_count, likes_sum, comments_sum, avg_likes, avg_comments } = sumEngagement(posts);
  const engagementRate = calcRate(avg_likes, avg_comments, followerCount);
  const engagementPosts = used.map((item) => item.url).join("|");
  return {
    engagement_rate: engagementRate,
    engagement_post_count,
    engagement_posts: engagementPosts,
    follower_count: followerCount,
    avg_likes,
    avg_comments,
    total_likes: likes_sum,
    total_comments: comments_sum,
    engagement_refresh_error: null,
    last_engagement_refresh_at: new Date().toISOString(),
  };
}

async function patchCandidate(env, id, payload) {
  const nextPayload = { ...payload };
  if (!Object.keys(nextPayload).length) return null;

  while (Object.keys(nextPayload).length) {
    const response = await fetch(`${env.supabaseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        ...buildSupabaseHeaders(env),
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify(nextPayload),
    });
    const text = await response.text();
    if (response.ok) {
      return text ? JSON.parse(text) : null;
    }

    const missing = parseMissingColumn(text);
    if (missing && Object.hasOwn(nextPayload, missing)) {
      delete nextPayload[missing];
      continue;
    }

    throw new Error(`${response.status}: ${text}`);
  }
  return null;
}

async function main() {
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const args = parseArgs(process.argv.slice(2));
  args.cookie = args.cookie || env.instagramCookie || "";
  if (!args.cookie) {
    throw new Error("IG_COOKIE is required in .env or --cookie. Supabase was not modified.");
  }
  const rows = await fetchSupabaseRows(env, args);
  console.log(`[engagement] target candidates: ${rows.length}`);
  if (args.onlyMissingFollowers) {
    console.log("[engagement] mode: only rows with missing follower_count");
  }
  if (args.onlyMissingEr) {
    console.log("[engagement] mode: only rows with missing engagement_rate");
  }

  let updated = 0;
  for (const row of rows) {
    if (args.onlyWithSellerId && !row.seller_id && !args.includeWithoutSellerId) continue;
    const sellerName = normalizeText(row.seller_name || row.seller_id || row.profile_url || `row-${row.id}`);
    console.log(`[engagement] target: @${sellerName} / id ${row.seller_id || "-"}`);
    try {
      const payload = await collectForRow(row, args);
      await patchCandidate(env, row.id, payload);
      updated += 1;
      console.log(`[engagement] updated: @${sellerName} (${payload.engagement_post_count})`);
    } catch (error) {
      console.log(`[engagement] fail @${sellerName}: ${error.message}`);
      await patchCandidate(env, row.id, {
        engagement_refresh_error: String(error.message || "engagement refresh failed").slice(0, 500),
        last_engagement_refresh_at: new Date().toISOString(),
      });
    }
    await sleep(args.intervalMs);
  }

  console.log(`[engagement] done. updated=${updated}`);
}

main().catch((error) => {
  console.error("[error]", error.message);
  process.exit(1);
});
