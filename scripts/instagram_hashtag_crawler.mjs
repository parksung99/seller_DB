import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_HASHTAG_FILE = "hashtags.txt";
const DEFAULT_OUTPUT_DIR = "data";
const DEFAULT_LIMIT_PER_TAG = 50;
const DEFAULT_DELAY_MS = 2500;
const DEFAULT_SEARCH_DOC_ID = "26586987494245638";

const SELLING_KEYWORDS = [
  "공동구매",
  "공구",
  "마켓",
  "구매",
  "주문",
  "판매",
  "협찬",
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
    else if (arg === "--tag" || arg === "--hashtag") args.hashtags.push(argv[++i]);
  }

  return args;
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

function extractCandidatesFromSearch(json, hashtag) {
  const items = extractMediaItemsFromSearch(json);

  return items
    .filter((item) => item?.code && item?.user?.username)
    .map((item) => {
      const caption = item.caption?.text || item.caption_text || item.accessibility_caption || "";
      const beautySignal = scoreBeautySignal(`${item.user.full_name || ""} ${caption}`, hashtag);
      const sellingDetail = scoreSellingSignalDetail(caption, hashtag);
      const negativeSignal = scoreNegativeSignal(`${item.user.full_name || ""} ${caption}`);
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

function aggregateSellerRows(rows) {
  const bySeller = new Map();

  for (const row of rows.filter((item) => item.seller_name)) {
    const current = bySeller.get(row.seller_name) || {
      seller_name: row.seller_name,
      channel: row.channel,
      profile_url: row.profile_url || `https://www.instagram.com/${row.seller_name}/`,
      hashtags: new Set(),
      post_urls: [],
      categories: new Set(),
      beauty_score: 0,
      selling_score: 0,
      negative_score: 0,
      combination_score: 0,
      combination_grades: new Set(),
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
    current.beauty_score += Number(row.beauty_score || 0);
    current.selling_score += Number(row.selling_score || 0);
    current.negative_score += Number(row.negative_score || 0);
    current.combination_score += Number(row.combination_score || 0);
    if (row.combination_grade) current.combination_grades.add(row.combination_grade);
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
      const grade = gradeSeller({
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
        grade,
        matched_hashtags_count: matchedHashtagsCount,
        matched_hashtags: [...seller.hashtags].join("|"),
        category: [...seller.categories].join("|"),
        beauty_score: seller.beauty_score,
        selling_score: seller.selling_score,
        negative_score: seller.negative_score,
        combination_score: seller.combination_score,
        combination_grades: [...seller.combination_grades].join("|"),
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

    rows = rows.slice(0, args.limitPerTag);

    diagnostics.push({
      hashtag,
      source,
      status: result.status,
      contentType: result.contentType,
      responseLength: result.text.length,
      rows: rows.length,
      loginLimited:
        result.text.includes("PolarisCAAIGLoginHomepageController") ||
        result.text.includes("is_logged_out_user") ||
        result.text.toLowerCase().includes("log in"),
    });

    allRows.push(...rows);

    console.log(`[instagram] #${hashtag} 후보 ${rows.length}건`);
    await sleep(args.delayMs);
  }

  const rows = dedupeRows(allRows);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = path.join(args.outputDir, `instagram_hashtag_sellers_${stamp}.csv`);
  const summaryPath = path.join(args.outputDir, `instagram_beauty_seller_summary_${stamp}.csv`);
  const jsonPath = path.join(args.outputDir, `instagram_hashtag_diagnostics_${stamp}.json`);
  const sellerSummary = aggregateSellerRows(rows);
  const summaryColumns = [
    "seller_name",
    "channel",
    "profile_url",
    "grade",
    "matched_hashtags_count",
    "matched_hashtags",
    "category",
    "beauty_score",
    "selling_score",
    "negative_score",
    "combination_score",
    "combination_grades",
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
  await fs.writeFile(summaryPath, `\uFEFF${toCsv(sellerSummary, summaryColumns)}\n`, "utf8");
  await fs.writeFile(jsonPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`[done] CSV: ${csvPath}`);
  console.log(`[done] seller summary: ${summaryPath}`);
  console.log(`[done] diagnostics: ${jsonPath}`);
  console.log(`[done] total unique rows: ${rows.length}`);
  console.log(`[done] total unique sellers: ${sellerSummary.length}`);

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
