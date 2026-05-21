import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readSupabaseEnv } from "./supabase_env.mjs";

const DEFAULT_HASHTAG_FILE = "hashtags.txt";
const DEFAULT_OUTPUT_DIR = "data";
const DEFAULT_LIMIT_PER_TAG = 50;
const DEFAULT_DELAY_MS = 2500;
const DEFAULT_PROFILE_DELAY_MS = 1200;
const DEFAULT_SEARCH_DOC_ID = "26586987494245638";
const WEB_PROFILE_ENDPOINT = "https://i.instagram.com/api/v1/users/web_profile_info/";
const CANDIDATES_TABLE = "beauty_seller_candidates";
const EXCLUDED_TABLE = "excluded_instagram_handles";

const SELLING_KEYWORDS = [
  "광고",
  "공동구매",
  "공구",
  "마켓",
  "구매",
  "주문",
  "판매",
  "협찬",
  "제품제공",
  "문의",
  "디엠",
  "dm",
  "오픈채팅",
  "스토어",
  "smartstore",
  "링크",
];

const BEAUTY_KEYWORDS = [
  "뷰티",
  "화장품",
  "스킨케어",
  "기초",
  "앰플",
  "세럼",
  "크림",
  "토너",
  "에센스",
  "마스크팩",
  "팩",
  "피부",
  "피부관리",
  "클렌징",
  "선크림",
  "쿠션",
  "립",
  "메이크업",
  "올리브영",
  "올영",
  "코덕",
  "이너뷰티",
  "콜라겐",
  "괄사",
  "홈케어",
  "컨실러",
  "마스카라",
  "하이라이터",
  "블러셔",
  "쉐딩",
  "틴트",
  "프라이머",
  "다크서클",
  "잡티",
  "색소침착",
  "트러블",
  "모공",
  "톤업",
  "미백",
  "주름",
  "수분",
  "보습",
  "속눈썹",
];

const NEGATIVE_KEYWORDS = [
  "강의",
  "컨퍼런스",
  "교육",
  "클래스",
  "마케팅",
  "마케터",
  "sns",
  "인스타툰",
  "세미나",
  "창업",
  "수익화",
  "브랜딩",
  "강사",
];

const BEAUTY_HASHTAGS = new Set([
  "뷰티공구",
  "화장품공구",
  "스킨케어공구",
  "기초화장품",
  "앰플추천",
  "크림추천",
  "마스크팩공구",
  "이너뷰티공구",
  "피부관리",
  "뷰티마켓",
  "화장품추천",
  "makeup",
  "makeuptutorial",
  "메이크업",
  "커버메이크업",
  "컨실러",
  "컨실러추천",
  "마스카라",
  "마스카라추천",
  "올리브영",
  "올영추천템",
  "코덕",
  "뷰티크리에이터",
  "뷰티꿀팁",
  "클린메이크업",
  "코랄메이크업",
  "뮤트립추천",
  "세럼추천",
  "모공앰플",
  "하이라이터",
]);

const COMMERCIAL_SIGNAL_HASHTAGS = new Set([
  "광고",
  "협찬",
  "제품제공",
  "ad",
  "추천",
  "댓글이벤트",
  "이벤트",
  "공구",
  "공동구매",
  "구매",
  "주문",
  "링크",
]);

const FORMAT_SIGNAL_HASHTAGS = new Set([
  "fyp",
  "pov",
  "transition",
  "makeuptutorial",
  "튜토리얼",
  "공감",
]);

const REQUIRED_COMMERCIAL_TERMS = [
  "광고",
  "협찬",
  "제품제공",
  "ad",
  "공구",
  "공동구매",
  "마켓",
  "판매",
];

const PROSPECT_DESIRE_KEYWORDS = [
  "인플루언서",
  "인플",
  "크리에이터",
  "협찬",
  "제품제공",
  "제공",
  "광고",
  "체험단",
  "리뷰",
  "내돈내산",
  "공병템",
  "재구매템",
  "올영",
  "올리브영",
  "화장품추천",
  "뷰티리뷰",
  "마케터",
  "마케팅",
  "md",
  "bm",
  "브랜드",
  "직장인",
  "부업",
  "n잡",
  "퇴근후",
  "퍼스널브랜딩",
  "릴스",
  "성장",
  "문의",
  "dm",
];

const PROSPECT_SIGNAL_HASHTAGS = new Set([
  "올영추천",
  "올리브영추천",
  "올영추천템",
  "내돈내산",
  "공병템",
  "재구매템",
  "뷰티리뷰",
  "화장품추천",
  "코덕",
  "협찬",
  "제품제공",
  "광고",
  "체험단",
  "뷰티마케터",
  "마케터일상",
  "직장인부업",
  "직장인일상",
  "n잡",
  "n잡러",
  "부업",
  "퇴근후부업",
  "인스타성장",
  "릴스성장",
  "퍼스널브랜딩",
  "뷰티크리에이터",
]);

const PROSPECT_PERSONA_RULES = [
  ["뷰티리뷰러", ["올영추천", "올리브영추천", "올영추천템", "내돈내산", "공병템", "재구매템", "뷰티리뷰", "화장품추천", "코덕"]],
  ["협찬초기", ["협찬", "제품제공", "광고", "체험단", "제공"]],
  ["뷰티마케터", ["뷰티마케터", "마케터일상", "마케팅", "마케터", "md", "bm", "브랜드"]],
  ["직장인N잡", ["직장인부업", "직장인일상", "n잡", "n잡러", "부업", "퇴근후부업", "퇴근후", "월급외수익"]],
  ["성장지향크리에이터", ["인스타성장", "릴스성장", "퍼스널브랜딩", "뷰티크리에이터", "크리에이터", "인플루언서", "인플"]],
];

const PROSPECT_NOISE_KEYWORDS = [
  "official",
  "공식",
  "뉴스",
  "신문",
  "일보",
  "매거진",
  "병원",
  "의원",
  "클리닉",
  "학원",
  "교육",
  "강의",
  "클래스",
  "컨설팅",
  "대행",
  "에이전시",
  "agency",
  "채용",
  "알바",
];

function parseArgs(argv) {
  const args = {
    hashtagFile: DEFAULT_HASHTAG_FILE,
    outputDir: DEFAULT_OUTPUT_DIR,
    limitPerTag: DEFAULT_LIMIT_PER_TAG,
    delayMs: DEFAULT_DELAY_MS,
    hashtags: [],
    cookie: process.env.IG_COOKIE || "",
    cookieFile: "",
    searchDocId: process.env.IG_SEARCH_DOC_ID || DEFAULT_SEARCH_DOC_ID,
    excludedHandlesFile: "",
    skipSupabaseExclusions: false,
    requireBeauty: false,
    requireCommercial: false,
    enrichProfileEmail: true,
    profileDelayMs: DEFAULT_PROFILE_DELAY_MS,
    audienceMode: "seller",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--hashtag-file") args.hashtagFile = argv[++i];
    else if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg === "--limit") args.limitPerTag = Number(argv[++i]);
    else if (arg === "--delay-ms") args.delayMs = Number(argv[++i]);
    else if (arg === "--cookie") args.cookie = argv[++i];
    else if (arg === "--cookie-file") args.cookieFile = argv[++i];
    else if (arg === "--search-doc-id") args.searchDocId = argv[++i];
    else if (arg === "--excluded-handles-file") args.excludedHandlesFile = argv[++i];
    else if (arg === "--skip-supabase-exclusions") args.skipSupabaseExclusions = true;
    else if (arg === "--require-beauty" || arg === "--beauty-only") args.requireBeauty = true;
    else if (arg === "--require-commercial" || arg === "--commercial-only") args.requireCommercial = true;
    else if (arg === "--skip-profile-email") args.enrichProfileEmail = false;
    else if (arg === "--profile-delay-ms") args.profileDelayMs = Number(argv[++i]) || args.profileDelayMs;
    else if (arg === "--audience-mode") args.audienceMode = argv[++i] || args.audienceMode;
    else if (arg === "--prospect-mode") args.audienceMode = "prospect";
    else if (arg === "--tag" || arg === "--hashtag") args.hashtags.push(argv[++i]);
  }

  if (!["seller", "prospect"].includes(args.audienceMode)) {
    throw new Error(`Unsupported --audience-mode: ${args.audienceMode}`);
  }

  return args;
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

function handlesFromCandidate(row) {
  return [
    normalizeHandle(row.seller_id),
    normalizeHandle(row.seller_name),
    normalizeHandle(row.profile_url),
  ].filter(Boolean);
}

async function readExcludedHandlesFile(filePath) {
  if (!filePath) return new Set();
  const text = await fs.readFile(filePath, "utf8");
  return new Set(
    text
      .split(/\r?\n/)
      .map((line) => normalizeHandle(line.split("#")[0]))
      .filter(Boolean)
  );
}

async function fetchSupabaseExcludedHandles(args) {
  if (args.skipSupabaseExclusions) return new Set();
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) return new Set();
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${EXCLUDED_TABLE}?select=handle&limit=10000`, {
    headers: {
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  if (response.ok) {
    return new Set((text ? JSON.parse(text) : []).map((row) => normalizeHandle(row.handle)).filter(Boolean));
  }
  if (response.status === 404) return new Set();
  throw new Error(`Failed to load excluded handles: ${response.status}: ${text}`);
}

async function fetchSupabaseCandidateExcludedHandles(args) {
  if (args.skipSupabaseExclusions) return new Set();
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) return new Set();
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${CANDIDATES_TABLE}?select=seller_id,seller_name,profile_url&review_status=eq.%EC%A0%9C%EC%99%B8&limit=10000`, {
    headers: {
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  if (response.ok) {
    return new Set((text ? JSON.parse(text) : []).flatMap(handlesFromCandidate));
  }
  if (response.status === 404) return new Set();
  throw new Error(`Failed to load excluded candidate handles: ${response.status}: ${text}`);
}

async function fetchSupabaseExistingHandles(args) {
  if (args.skipSupabaseExclusions) return new Set();
  const env = readSupabaseEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) return new Set();
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${CANDIDATES_TABLE}?select=seller_id,seller_name,profile_url&limit=10000`, {
    headers: {
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  if (response.ok) {
    return new Set((text ? JSON.parse(text) : []).flatMap(handlesFromCandidate));
  }
  if (response.status === 404) return new Set();
  throw new Error(`Failed to load existing candidate handles: ${response.status}: ${text}`);
}

function filterExcludedRows(rows, excludedHandles) {
  if (!excludedHandles.size) return rows;
  return rows.filter((row) => {
    const handle = handleFromRow(row);
    return !handle || !excludedHandles.has(handle);
  });
}

function filterBeautyRows(rows, requireBeauty) {
  if (!requireBeauty) return rows;
  return rows.filter((row) => {
    const beautyScore = Number(row.beauty_score || 0);
    return beautyScore > 0 || String(row.beauty_anchor_tags || "").trim();
  });
}

function filterCommercialRows(rows, requireCommercial) {
  if (!requireCommercial) return rows;
  return rows.filter((row) => {
    const commercialText = [
      row.matched_selling_keywords,
      row.commercial_signal_tags,
      row.caption_hashtags,
      row.notes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return REQUIRED_COMMERCIAL_TERMS.some((term) => commercialText.includes(term));
  });
}

function normalizeHashtag(tag) {
  return tag.replace(/^#/, "").trim();
}

async function readHashtags(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => normalizeHashtag(line.split("# ")[0]))
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function instagramWebHeaders(cookie, referer = "https://www.instagram.com/") {
  const csrfToken = getCookieValue(cookie, "csrftoken");
  return {
    accept: "application/json,text/plain,*/*",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    pragma: "no-cache",
    referer,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "x-csrftoken": csrfToken,
    "x-ig-app-id": "936619743392459",
    "x-requested-with": "XMLHttpRequest",
    ...(cookie ? { cookie } : {}),
  };
}

function extractEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function extractProfileImage(user) {
  return (
    user?.profile_pic_url_hd ||
    user?.hd_profile_pic_url_info?.url ||
    user?.profile_pic_url ||
    user?.profile_picture ||
    user?.profile_picture_url ||
    ""
  );
}

async function fetchProfileEmail(username, args) {
  if (!username || !args.cookie) return "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${WEB_PROFILE_ENDPOINT}?username=${encodeURIComponent(username)}`, {
      signal: controller.signal,
      headers: instagramWebHeaders(args.cookie, `https://www.instagram.com/${username}/`),
    });
    const text = await response.text();
    if (!response.ok) return "";
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return "";
    }
    const user = json?.data?.user || json?.user || json?.graphql?.user || {};
    return (
      user.business_email ||
      user.public_email ||
      user.email ||
      extractEmail(user.biography || user.bio || user.full_name || text)
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichSellerEmails(sellers, args) {
  if (!args.enrichProfileEmail || !args.cookie) return sellers;
  const enriched = [];
  for (const seller of sellers) {
    const username = normalizeHandle(seller.seller_name || seller.profile_url);
    let profileEmail = seller.profile_email || "";
    if (!profileEmail) {
      try {
        profileEmail = await fetchProfileEmail(username, args);
      } catch (error) {
        console.log(`[instagram] @${username} 프로필 메일 확인 실패: ${error.message}`);
      }
      if (args.profileDelayMs) await sleep(args.profileDelayMs);
    }
    enriched.push({ ...seller, profile_email: profileEmail || "" });
  }
  return enriched;
}

async function fetchText(url, cookie) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        ...(cookie ? { cookie } : {}),
      },
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      url: response.url,
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getCookieValue(cookie, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`))?.[1] || "";
}

async function fetchInstagramSearch(hashtag, args) {
  const sessionId = crypto.randomUUID();
  const variables = {
    query: `#${hashtag}`,
    search_session_id: sessionId,
    serp_session_id: sessionId,
  };
  const url = `https://www.instagram.com/graphql/query?doc_id=${encodeURIComponent(
    args.searchDocId
  )}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
  const csrfToken = getCookieValue(args.cookie, "csrftoken");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "referer": `https://www.instagram.com/explore/search/keyword/?q=%23${encodeURIComponent(hashtag)}`,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "x-csrftoken": csrfToken,
        "x-ig-app-id": "936619743392459",
        "x-requested-with": "XMLHttpRequest",
        ...(args.cookie ? { cookie: args.cookie } : {}),
      },
    });
    const text = await response.text();
    let json = null;

    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      url: response.url,
      text,
      json,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value;
  }
}

function stripNoiseUsername(username) {
  const lower = username.toLowerCase();
  if (
    lower === "instagram" ||
    lower === "explore" ||
    lower === "accounts" ||
    lower === "static" ||
    lower === "www" ||
    lower === "ajax" ||
    lower === "rsrc.php"
  ) {
    return "";
  }
  return username;
}

function extractCandidatesFromHtml(html, hashtag) {
  const shortcodes = unique([
    ...[...html.matchAll(/"shortcode"\s*:\s*"([A-Za-z0-9_-]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/\/p\/([A-Za-z0-9_-]+)\//g)].map((match) => match[1]),
    ...[...html.matchAll(/\/reel\/([A-Za-z0-9_-]+)\//g)].map((match) => match[1]),
  ]);

  const usernames = unique([
    ...[...html.matchAll(/"username"\s*:\s*"([A-Za-z0-9._]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/instagram\.com\\?\/([A-Za-z0-9._]+)\\?\//g)].map((match) => match[1]),
  ])
    .map(stripNoiseUsername)
    .filter(Boolean);

  const captions = unique(
    [...html.matchAll(/"text"\s*:\s*"((?:\\"|[^"])*)"/g)]
      .map((match) => decodeJsonString(match[1]))
      .filter((text) => text.includes(hashtag) || SELLING_KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword)))
  );

  const postRows = shortcodes.map((shortcode) => ({
    seller_name: "",
    channel: "instagram",
    url: `https://www.instagram.com/p/${shortcode}/`,
    hashtag,
    category: "",
    follower_count: "",
    engagement_signal: "",
    selling_signal: scoreSellingSignal(captions.join(" ")),
    dm_available: "",
    priority: "",
    notes: captions[0] ? truncate(captions[0], 180) : "hashtag page post candidate",
  }));

  const profileRows = usernames.map((username) => ({
    seller_name: username,
    channel: "instagram",
    url: `https://www.instagram.com/${username}/`,
    hashtag,
    category: "",
    follower_count: "",
    engagement_signal: "",
    selling_signal: scoreSellingSignal(captions.join(" ")),
    dm_available: "unknown",
    priority: "",
    notes: captions[0] ? truncate(captions[0], 180) : "profile candidate from hashtag page",
  }));

  return [...profileRows, ...postRows];
}

function extractMediaItemsFromSearch(json) {
  const edges = json?.data?.xdt_fbsearch__top_serp_graphql?.edges || [];
  return edges.flatMap((edge) => {
    const node = edge?.node;
    if (!node) return [];
    if (Array.isArray(node.items)) return node.items;
    if (node.media) return [node.media];
    return [];
  });
}

function inferCategory(text) {
  const lower = text.toLowerCase();
  const categories = [
    ["육아", ["육아", "아기", "키즈", "유아", "맘"]],
    ["뷰티", ["뷰티", "화장품", "스킨", "메이크업", "피부"]],
    ["패션", ["패션", "옷", "의류", "코디", "가방", "신발"]],
    ["다이어트", ["다이어트", "식단", "운동", "헬스"]],
    ["생활", ["살림", "주방", "생활", "리빙"]],
    ["식품", ["맛집", "간식", "푸드", "식품", "먹거리"]],
  ];

  return categories.find(([, keywords]) => keywords.some((keyword) => lower.includes(keyword)))?.[0] || "";
}

function matchedKeywords(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

function scoreBeautySignal(text, hashtag) {
  const matched = matchedKeywords(`${hashtag} ${text}`, BEAUTY_KEYWORDS);
  let score = matched.length;
  if (BEAUTY_HASHTAGS.has(hashtag)) score += 3;
  return {
    score,
    keywords: unique(matched),
  };
}

function scoreSellingSignalDetail(text, hashtag) {
  const matched = matchedKeywords(`${hashtag} ${text}`, SELLING_KEYWORDS);
  let score = matched.length;
  if (["공동구매", "공구", "마켓", "인스타마켓"].includes(hashtag)) score += 2;
  return {
    score,
    keywords: unique(matched),
  };
}

function scoreNegativeSignal(text) {
  const matched = matchedKeywords(text, NEGATIVE_KEYWORDS);
  return {
    score: matched.length,
    keywords: unique(matched),
  };
}

function scoreProspectSignal(text, hashtag) {
  const captionHashtags = extractHashtags(text);
  const allTags = unique([hashtag.toLowerCase(), ...captionHashtags]);
  const lower = text.toLowerCase();
  const matchedKeywordList = matchedKeywords(`${hashtag} ${text}`, PROSPECT_DESIRE_KEYWORDS);
  const signalTags = allTags.filter((tag) => PROSPECT_SIGNAL_HASHTAGS.has(tag));
  const personas = PROSPECT_PERSONA_RULES
    .filter(([, signals]) =>
      signals.some((signal) => allTags.includes(signal.toLowerCase()) || lower.includes(signal.toLowerCase()))
    )
    .map(([persona]) => persona);
  const hasBeautyContext =
    matchedKeywords(`${hashtag} ${text}`, BEAUTY_KEYWORDS).length > 0 ||
    allTags.some((tag) => BEAUTY_HASHTAGS.has(tag) || matchedKeywords(tag, BEAUTY_KEYWORDS).length);

  let score = matchedKeywordList.length + signalTags.length * 2 + personas.length * 2;
  if (hasBeautyContext) score += 3;
  if (personas.includes("협찬초기") && personas.includes("뷰티리뷰러")) score += 4;
  if (personas.includes("뷰티마케터") && hasBeautyContext) score += 4;
  if (personas.includes("직장인N잡") && hasBeautyContext) score += 3;
  if (personas.includes("성장지향크리에이터") && hasBeautyContext) score += 2;

  return {
    score,
    keywords: unique(matchedKeywordList),
    tags: unique(signalTags),
    personas: unique(personas),
  };
}

function scoreProspectNoise(text) {
  const matched = matchedKeywords(text, PROSPECT_NOISE_KEYWORDS);
  return {
    score: matched.length,
    keywords: unique(matched),
  };
}

function extractHashtags(text) {
  return unique([...text.matchAll(/#[\p{L}\p{N}_]+/gu)].map((match) => match[0].slice(1).toLowerCase()));
}

function scoreCombinationSignal({ caption, hashtag, beautyScore, sellingScore }) {
  const captionHashtags = extractHashtags(caption);
  const allTags = unique([hashtag.toLowerCase(), ...captionHashtags]);
  const beautyAnchors = allTags.filter((tag) => BEAUTY_HASHTAGS.has(tag) || matchedKeywords(tag, BEAUTY_KEYWORDS).length);
  const commercialSignals = allTags.filter((tag) => COMMERCIAL_SIGNAL_HASHTAGS.has(tag));
  const formatSignals = allTags.filter((tag) => FORMAT_SIGNAL_HASHTAGS.has(tag));
  const hasBeauty = beautyAnchors.length > 0 || beautyScore > 0;
  const hasCommercial = commercialSignals.length > 0 || sellingScore > 0;
  const hasFormat = formatSignals.length > 0;

  let grade = "하";
  let score = 0;

  if (hasBeauty) score += 4;
  if (hasCommercial) score += 3;
  if (hasFormat) score += 2;

  if (hasBeauty && hasCommercial && hasFormat) {
    grade = "상";
    score += 4;
  } else if (hasBeauty && hasCommercial) {
    grade = "상";
    score += 2;
  } else if (hasBeauty && hasFormat) {
    grade = "중";
    score += 1;
  } else if (hasBeauty) {
    grade = "중";
  }

  return {
    score,
    grade,
    captionHashtags,
    beautyAnchors,
    commercialSignals,
    formatSignals,
  };
}

function priorityFromSignals({ likeCount, commentCount, sellingSignal, isPrivate }) {
  if (isPrivate) return "low";
  if (sellingSignal && (likeCount >= 100 || commentCount >= 10)) return "high";
  if (sellingSignal || likeCount >= 100 || commentCount >= 10) return "medium";
  return "low";
}

function gradeSeller({ beautyScore, sellingScore, matchedHashtagsCount, totalLikes, totalComments, negativeScore }) {
  if (negativeScore >= 2) return "하";

  const engagementScore = totalLikes >= 500 || totalComments >= 50 ? 2 : totalLikes >= 100 || totalComments >= 10 ? 1 : 0;
  const totalScore = beautyScore * 2 + sellingScore + matchedHashtagsCount * 2 + engagementScore - negativeScore * 2;

  if (beautyScore >= 5 && sellingScore >= 2 && matchedHashtagsCount >= 2 && totalScore >= 14) return "상";
  if (beautyScore >= 2 && sellingScore >= 1 && totalScore >= 7) return "중";
  return "하";
}

function gradeProspect({ prospectScore, prospectNoiseScore, beautyScore, sellingScore, matchedHashtagsCount, totalLikes, totalComments }) {
  if (prospectNoiseScore >= 2) return "하";

  const engagementScore = totalLikes >= 500 || totalComments >= 50 ? 2 : totalLikes >= 100 || totalComments >= 10 ? 1 : 0;
  const totalScore =
    prospectScore * 2 + beautyScore + sellingScore + matchedHashtagsCount * 2 + engagementScore - prospectNoiseScore * 8;

  if (prospectScore >= 12 && matchedHashtagsCount >= 2 && totalScore >= 30) return "상";
  if (prospectScore >= 8 && totalScore >= 18) return "상";
  if (prospectScore >= 5 && totalScore >= 11) return "중";
  return "하";
}

function extractCandidatesFromSearch(json, hashtag) {
  const items = extractMediaItemsFromSearch(json);

  return items
    .filter((item) => item?.code && item?.user?.username)
    .map((item) => {
      const caption = item.caption?.text || item.caption_text || item.accessibility_caption || "";
      const beautySignal = scoreBeautySignal(`${item.user.full_name || ""} ${caption}`, hashtag);
      const sellingDetail = scoreSellingSignalDetail(caption, hashtag);
      const negativeSignal = scoreNegativeSignal(`${item.user.full_name || ""} ${caption}`);
      const prospectSignal = scoreProspectSignal(`${item.user.full_name || ""} ${caption}`, hashtag);
      const prospectNoise = scoreProspectNoise(`${item.user.username || ""} ${item.user.full_name || ""} ${caption}`);
      const combinationSignal = scoreCombinationSignal({
        caption,
        hashtag,
        beautyScore: beautySignal.score,
        sellingScore: sellingDetail.score,
      });
      const sellingSignal = sellingDetail.keywords.join("|");
      const likeCount = Number(item.like_count || 0);
      const commentCount = Number(item.comment_count || 0);
      const viewCount = Number(item.view_count || 0);
      const engagementParts = [
        `likes:${likeCount}`,
        `comments:${commentCount}`,
        viewCount ? `views:${viewCount}` : "",
      ].filter(Boolean);

      return {
        seller_name: item.user.username,
        channel: "instagram",
        url: `https://www.instagram.com/p/${item.code}/`,
        profile_url: `https://www.instagram.com/${item.user.username}/`,
        profile_email: item.user.business_email || item.user.public_email || extractEmail(`${item.user.biography || ""} ${caption}`),
        profile_image_url: extractProfileImage(item.user),
        hashtag,
        category: inferCategory(`${item.user.full_name || ""} ${caption}`),
        follower_count: "",
        engagement_signal: engagementParts.join("|"),
        selling_signal: sellingSignal,
        beauty_score: beautySignal.score,
        selling_score: sellingDetail.score,
        negative_score: negativeSignal.score,
        combination_score: combinationSignal.score,
        combination_grade: combinationSignal.grade,
        prospect_score: prospectSignal.score,
        prospect_noise_score: prospectNoise.score,
        prospect_personas: prospectSignal.personas.join("|"),
        prospect_signal_tags: prospectSignal.tags.join("|"),
        matched_prospect_keywords: prospectSignal.keywords.join("|"),
        prospect_noise_keywords: prospectNoise.keywords.join("|"),
        caption_hashtags: combinationSignal.captionHashtags.join("|"),
        beauty_anchor_tags: combinationSignal.beautyAnchors.join("|"),
        commercial_signal_tags: combinationSignal.commercialSignals.join("|"),
        format_signal_tags: combinationSignal.formatSignals.join("|"),
        matched_beauty_keywords: beautySignal.keywords.join("|"),
        matched_selling_keywords: sellingDetail.keywords.join("|"),
        negative_keywords: negativeSignal.keywords.join("|"),
        like_count: likeCount,
        comment_count: commentCount,
        dm_available: item.user.is_private ? "private" : "unknown",
        priority: priorityFromSignals({
          likeCount,
          commentCount,
          sellingSignal,
          isPrivate: item.user.is_private,
        }),
        notes: truncate(`${item.user.full_name || ""} ${caption}`.trim(), 220),
      };
    });
}

function scoreSellingSignal(text) {
  const lower = text.toLowerCase();
  const matched = SELLING_KEYWORDS.filter((keyword) => lower.includes(keyword));
  return matched.length ? matched.join("|") : "";
}

function truncate(text, maxLength) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.channel}:${row.url}:${row.hashtag}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function aggregateSellerRows(rows, audienceMode = "seller") {
  const bySeller = new Map();

  for (const row of rows.filter((item) => item.seller_name)) {
    const current = bySeller.get(row.seller_name) || {
      seller_name: row.seller_name,
      channel: row.channel,
      profile_url: row.profile_url || `https://www.instagram.com/${row.seller_name}/`,
      profile_email: row.profile_email || "",
      profile_image_url: row.profile_image_url || "",
      hashtags: new Set(),
      post_urls: [],
      categories: new Set(),
      beauty_score: 0,
      selling_score: 0,
      negative_score: 0,
      combination_score: 0,
      combination_grades: new Set(),
      prospect_score: 0,
      prospect_noise_score: 0,
      prospect_personas: new Set(),
      prospect_signal_tags: new Set(),
      matched_prospect_keywords: new Set(),
      prospect_noise_keywords: new Set(),
      beauty_anchor_tags: new Set(),
      commercial_signal_tags: new Set(),
      format_signal_tags: new Set(),
      like_count: 0,
      comment_count: 0,
      matched_beauty_keywords: new Set(),
      matched_selling_keywords: new Set(),
      negative_keywords: new Set(),
      dm_available: row.dm_available,
      notes: [],
    };

    current.hashtags.add(row.hashtag);
    if (row.url && !current.post_urls.includes(row.url)) current.post_urls.push(row.url);
    if (row.category) current.categories.add(row.category);
    if (!current.profile_email && row.profile_email) current.profile_email = row.profile_email;
    if (!current.profile_image_url && row.profile_image_url) current.profile_image_url = row.profile_image_url;
    current.beauty_score += Number(row.beauty_score || 0);
    current.selling_score += Number(row.selling_score || 0);
    current.negative_score += Number(row.negative_score || 0);
    current.combination_score += Number(row.combination_score || 0);
    current.prospect_score += Number(row.prospect_score || 0);
    current.prospect_noise_score += Number(row.prospect_noise_score || 0);
    if (row.combination_grade) current.combination_grades.add(row.combination_grade);
    for (const persona of String(row.prospect_personas || "").split("|").filter(Boolean)) current.prospect_personas.add(persona);
    for (const tag of String(row.prospect_signal_tags || "").split("|").filter(Boolean)) current.prospect_signal_tags.add(tag);
    for (const keyword of String(row.matched_prospect_keywords || "").split("|").filter(Boolean)) current.matched_prospect_keywords.add(keyword);
    for (const keyword of String(row.prospect_noise_keywords || "").split("|").filter(Boolean)) current.prospect_noise_keywords.add(keyword);
    for (const tag of String(row.beauty_anchor_tags || "").split("|").filter(Boolean)) current.beauty_anchor_tags.add(tag);
    for (const tag of String(row.commercial_signal_tags || "").split("|").filter(Boolean)) current.commercial_signal_tags.add(tag);
    for (const tag of String(row.format_signal_tags || "").split("|").filter(Boolean)) current.format_signal_tags.add(tag);
    current.like_count += Number(row.like_count || 0);
    current.comment_count += Number(row.comment_count || 0);
    for (const keyword of String(row.matched_beauty_keywords || "").split("|").filter(Boolean)) current.matched_beauty_keywords.add(keyword);
    for (const keyword of String(row.matched_selling_keywords || "").split("|").filter(Boolean)) current.matched_selling_keywords.add(keyword);
    for (const keyword of String(row.negative_keywords || "").split("|").filter(Boolean)) current.negative_keywords.add(keyword);
    if (row.notes) current.notes.push(row.notes);

    bySeller.set(row.seller_name, current);
  }

  return [...bySeller.values()]
    .map((seller) => {
      const matchedHashtagsCount = seller.hashtags.size;
      const grade =
        audienceMode === "prospect"
          ? gradeProspect({
              prospectScore: seller.prospect_score,
              prospectNoiseScore: seller.prospect_noise_score,
              beautyScore: seller.beauty_score,
              sellingScore: seller.selling_score,
              matchedHashtagsCount,
              totalLikes: seller.like_count,
              totalComments: seller.comment_count,
            })
          : gradeSeller({
              beautyScore: seller.beauty_score,
              sellingScore: seller.selling_score,
              matchedHashtagsCount,
              totalLikes: seller.like_count,
              totalComments: seller.comment_count,
              negativeScore: seller.negative_score,
            });

      return {
        seller_name: seller.seller_name,
        channel: seller.channel,
        profile_url: seller.profile_url,
        profile_email: seller.profile_email,
        profile_image_url: seller.profile_image_url,
        grade,
        matched_hashtags_count: matchedHashtagsCount,
        matched_hashtags: [...seller.hashtags].join("|"),
        category: [...seller.categories].join("|"),
        beauty_score: seller.beauty_score,
        selling_score: seller.selling_score,
        negative_score: seller.negative_score,
        combination_score: seller.combination_score,
        combination_grades: [...seller.combination_grades].join("|"),
        prospect_score: seller.prospect_score,
        prospect_noise_score: seller.prospect_noise_score,
        prospect_personas: [...seller.prospect_personas].join("|"),
        prospect_signal_tags: [...seller.prospect_signal_tags].join("|"),
        matched_prospect_keywords: [...seller.matched_prospect_keywords].join("|"),
        prospect_noise_keywords: [...seller.prospect_noise_keywords].join("|"),
        total_likes: seller.like_count,
        total_comments: seller.comment_count,
        matched_beauty_keywords: [...seller.matched_beauty_keywords].join("|"),
        matched_selling_keywords: [...seller.matched_selling_keywords].join("|"),
        negative_keywords: [...seller.negative_keywords].join("|"),
        beauty_anchor_tags: [...seller.beauty_anchor_tags].join("|"),
        commercial_signal_tags: [...seller.commercial_signal_tags].join("|"),
        format_signal_tags: [...seller.format_signal_tags].join("|"),
        dm_available: seller.dm_available,
        sample_post_urls: seller.post_urls.slice(0, 3).join("|"),
        notes: truncate(seller.notes.join(" "), 260),
      };
    })
    .sort((a, b) => {
      const gradeRank = { "상": 3, "중": 2, "하": 1 };
      return (
        gradeRank[b.grade] - gradeRank[a.grade] ||
        b.prospect_score - a.prospect_score ||
        b.beauty_score - a.beauty_score ||
        b.combination_score - a.combination_score ||
        b.selling_score - a.selling_score ||
        b.total_comments - a.total_comments
      );
    });
}

function toCsv(rows, columns) {
  const selectedColumns = columns || [
    "seller_name",
    "channel",
    "url",
    "profile_url",
    "profile_email",
    "profile_image_url",
    "hashtag",
    "category",
    "follower_count",
    "engagement_signal",
    "selling_signal",
    "beauty_score",
    "selling_score",
    "negative_score",
    "combination_score",
    "combination_grade",
    "prospect_score",
    "prospect_noise_score",
    "prospect_personas",
    "prospect_signal_tags",
    "matched_prospect_keywords",
    "prospect_noise_keywords",
    "caption_hashtags",
    "beauty_anchor_tags",
    "commercial_signal_tags",
    "format_signal_tags",
    "matched_beauty_keywords",
    "matched_selling_keywords",
    "negative_keywords",
    "like_count",
    "comment_count",
    "dm_available",
    "priority",
    "notes",
  ];

  const escapeCell = (value) => {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  return [
    selectedColumns.join(","),
    ...rows.map((row) => selectedColumns.map((column) => escapeCell(row[column])).join(",")),
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cookieFile && !args.cookie) {
    args.cookie = (await fs.readFile(args.cookieFile, "utf8")).trim();
  }

  const hashtags = args.hashtags.length ? args.hashtags.map(normalizeHashtag) : await readHashtags(args.hashtagFile);
  const supabaseExcludedHandles = await fetchSupabaseExcludedHandles(args);
  const candidateExcludedHandles = await fetchSupabaseCandidateExcludedHandles(args);
  const existingDbHandles = await fetchSupabaseExistingHandles(args);
  const fileExcludedHandles = await readExcludedHandlesFile(args.excludedHandlesFile);
  const excludedHandles = new Set([...supabaseExcludedHandles, ...candidateExcludedHandles, ...existingDbHandles, ...fileExcludedHandles]);
  console.log(`[instagram] excluded handles loaded: ${supabaseExcludedHandles.size}`);
  console.log(`[instagram] candidate excluded handles loaded: ${candidateExcludedHandles.size}`);
  console.log(`[instagram] existing DB handles loaded: ${existingDbHandles.size}`);
  if (fileExcludedHandles.size) console.log(`[instagram] file excluded handles loaded: ${fileExcludedHandles.size}`);

  await fs.mkdir(args.outputDir, { recursive: true });

  const allRows = [];
  const diagnostics = [];

  for (const hashtag of hashtags) {
    const htmlUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`;
    console.log(`[instagram] #${hashtag} 검색 API 요청 중`);

    let result = null;
    let rows = [];
    let source = "graphql_search";

    if (args.cookie) {
      result = await fetchInstagramSearch(hashtag, args);
      rows = result.json ? extractCandidatesFromSearch(result.json, hashtag) : [];
    }

    if (!rows.length) {
      source = "html_fallback";
      console.log(`[instagram] #${hashtag} 검색 API 후보 없음. HTML fallback 요청 중: ${htmlUrl}`);
      result = await fetchText(htmlUrl, args.cookie);
      rows = extractCandidatesFromHtml(result.text, hashtag);
    }

    const beforeBeautyFilter = rows.length;
    rows = filterBeautyRows(rows, args.requireBeauty);
    const afterBeautyFilter = rows.length;
    const beforeCommercialFilter = rows.length;
    rows = filterCommercialRows(rows, args.requireCommercial);
    const afterCommercialFilter = rows.length;
    const beforeExclude = rows.length;
    rows = filterExcludedRows(rows, excludedHandles);
    const excludedRows = beforeExclude - rows.length;
    rows = rows.slice(0, args.limitPerTag);

    diagnostics.push({
      hashtag,
      source,
      status: result.status,
      contentType: result.contentType,
      responseLength: result.text.length,
      rows: rows.length,
      nonBeautyRows: beforeBeautyFilter - afterBeautyFilter,
      nonCommercialRows: beforeCommercialFilter - afterCommercialFilter,
      excludedRows,
      loginLimited:
        result.text.includes("PolarisCAAIGLoginHomepageController") ||
        result.text.includes("is_logged_out_user") ||
        result.text.toLowerCase().includes("log in"),
    });

    allRows.push(...rows);

    console.log(`[instagram] #${hashtag} 후보 ${rows.length}건`);
    if (excludedRows) console.log(`[instagram] #${hashtag} 기존/제외 핸들 ${excludedRows}건 제외`);
    await sleep(args.delayMs);
  }

  const rows = filterExcludedRows(
    filterCommercialRows(filterBeautyRows(dedupeRows(allRows), args.requireBeauty), args.requireCommercial),
    excludedHandles
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = path.join(args.outputDir, `instagram_hashtag_sellers_${stamp}.csv`);
  const summaryPath = path.join(args.outputDir, `instagram_beauty_seller_summary_${stamp}.csv`);
  const jsonPath = path.join(args.outputDir, `instagram_hashtag_diagnostics_${stamp}.json`);
  const sellerSummary = aggregateSellerRows(rows, args.audienceMode);
  const enrichedSellerSummary = await enrichSellerEmails(sellerSummary, args);
  const summaryColumns = [
    "seller_name",
    "channel",
    "profile_url",
    "profile_email",
    "profile_image_url",
    "grade",
    "matched_hashtags_count",
    "matched_hashtags",
    "category",
    "beauty_score",
    "selling_score",
    "negative_score",
    "combination_score",
    "combination_grades",
    "prospect_score",
    "prospect_noise_score",
    "prospect_personas",
    "prospect_signal_tags",
    "matched_prospect_keywords",
    "prospect_noise_keywords",
    "total_likes",
    "total_comments",
    "matched_beauty_keywords",
    "matched_selling_keywords",
    "negative_keywords",
    "beauty_anchor_tags",
    "commercial_signal_tags",
    "format_signal_tags",
    "dm_available",
    "sample_post_urls",
    "notes",
  ];

  await fs.writeFile(csvPath, `\uFEFF${toCsv(rows)}\n`, "utf8");
  await fs.writeFile(summaryPath, `\uFEFF${toCsv(enrichedSellerSummary, summaryColumns)}\n`, "utf8");
  await fs.writeFile(jsonPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`[done] CSV: ${csvPath}`);
  console.log(`[done] seller summary: ${summaryPath}`);
  console.log(`[done] diagnostics: ${jsonPath}`);
  console.log(`[done] total unique rows: ${rows.length}`);
  console.log(`[done] total unique sellers: ${enrichedSellerSummary.length}`);

    if (!rows.length) {
    console.log("");
    console.log("[notice] 인스타그램이 비로그인 요청에는 게시물/계정 데이터를 거의 노출하지 않았습니다.");
    console.log("[notice] 브라우저에서 로그인한 세션 쿠키를 IG_COOKIE 환경변수로 넣고 다시 실행하면 수집 가능성이 높아집니다.");
  }
}

main().catch((error) => {
  console.error("[error]", error);
  process.exit(1);
});
