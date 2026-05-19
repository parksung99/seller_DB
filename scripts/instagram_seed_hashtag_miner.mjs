import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_SEED_FILE = "seed_sellers.txt";
const DEFAULT_OUTPUT_DIR = "data";
const DEFAULT_DELAY_MS = 2500;
const DEFAULT_LIMIT_PER_SELLER = 50;
const DEFAULT_SEARCH_DOC_ID = "26586987494245638";

const BEAUTY_KEYWORDS = [
  "beauty",
  "makeup",
  "makeuptutorial",
  "뷰티",
  "메이크업",
  "커버메이크업",
  "올리브영",
  "올영",
  "코덕",
  "화장품",
  "스킨케어",
  "컨실러",
  "쿠션",
  "립",
  "틴트",
  "섀도우",
  "마스카라",
  "아이메이크업",
  "피부",
  "피부관리",
  "클렌징",
  "선크림",
  "앰플",
  "세럼",
  "크림",
  "토너",
  "마스크팩",
  "이너뷰티",
  "퍼스널컬러",
  "하이라이터",
  "블러셔",
  "쉐딩",
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

const SELLING_KEYWORDS = [
  "공구",
  "공동구매",
  "추천",
  "링크",
  "구매",
  "주문",
  "마켓",
  "할인",
  "광고",
  "협찬",
  "댓글",
  "문의",
  "dm",
];

function parseArgs(argv) {
  const args = {
    seedFile: DEFAULT_SEED_FILE,
    outputDir: DEFAULT_OUTPUT_DIR,
    delayMs: DEFAULT_DELAY_MS,
    limitPerSeller: DEFAULT_LIMIT_PER_SELLER,
    cookie: process.env.IG_COOKIE || "",
    cookieFile: "",
    searchDocId: process.env.IG_SEARCH_DOC_ID || DEFAULT_SEARCH_DOC_ID,
    sellers: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--seed-file") args.seedFile = argv[++i];
    else if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg === "--delay-ms") args.delayMs = Number(argv[++i]);
    else if (arg === "--limit") args.limitPerSeller = Number(argv[++i]);
    else if (arg === "--cookie") args.cookie = argv[++i];
    else if (arg === "--cookie-file") args.cookieFile = argv[++i];
    else if (arg === "--search-doc-id") args.searchDocId = argv[++i];
    else if (arg === "--seller") args.sellers.push(normalizeSeller(argv[++i]));
  }

  return args;
}

function normalizeSeller(value) {
  return value.replace(/^@/, "").trim();
}

async function readSeeds(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => normalizeSeller(line.split("# ")[0]))
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCookieValue(cookie, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`))?.[1] || "";
}

async function fetchSearch(query, args) {
  const sessionId = crypto.randomUUID();
  const variables = {
    query,
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
        "referer": `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "x-csrftoken": csrfToken,
        "x-ig-app-id": "936619743392459",
        "x-requested-with": "XMLHttpRequest",
        ...(args.cookie ? { cookie: args.cookie } : {}),
      },
    });

    const text = await response.text();
    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      text,
      json: JSON.parse(text),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractMediaItems(json) {
  const edges = json?.data?.xdt_fbsearch__top_serp_graphql?.edges || [];
  return edges.flatMap((edge) => {
    const node = edge?.node;
    if (!node) return [];
    if (Array.isArray(node.items)) return node.items;
    if (node.media) return [node.media];
    return [];
  });
}

function extractHashtags(text) {
  return [...text.matchAll(/#[\p{L}\p{N}_]+/gu)].map((match) => match[0].slice(1).toLowerCase());
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function matchedKeywords(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

function classifyHashtag(tag) {
  const beautyMatches = matchedKeywords(tag, BEAUTY_KEYWORDS);
  const sellingMatches = matchedKeywords(tag, SELLING_KEYWORDS);
  return {
    beauty_score: beautyMatches.length,
    selling_score: sellingMatches.length,
    matched_beauty_keywords: beautyMatches.join("|"),
    matched_selling_keywords: sellingMatches.join("|"),
  };
}

function toCsv(rows, columns) {
  const escapeCell = (value) => {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escapeCell(row[column])).join(",")),
  ].join("\n");
}

function truncate(text, maxLength) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cookieFile && !args.cookie) {
    args.cookie = (await fs.readFile(args.cookieFile, "utf8")).trim();
  }

  const sellers = args.sellers.length ? args.sellers : await readSeeds(args.seedFile);
  await fs.mkdir(args.outputDir, { recursive: true });

  const hashtagMap = new Map();
  const postRows = [];
  const diagnostics = [];

  for (const seller of sellers) {
    console.log(`[miner] @${seller} 검색 중`);
    const result = await fetchSearch(seller, args);
    const items = extractMediaItems(result.json)
      .filter((item) => item?.user?.username?.toLowerCase() === seller.toLowerCase())
      .slice(0, args.limitPerSeller);

    diagnostics.push({
      seller,
      status: result.status,
      contentType: result.contentType,
      responseLength: result.text.length,
      matchedPosts: items.length,
    });

    for (const item of items) {
      const caption = item.caption?.text || item.caption_text || "";
      const hashtags = unique(extractHashtags(caption));
      const postUrl = item.code ? `https://www.instagram.com/p/${item.code}/` : "";

      postRows.push({
        seller_name: seller,
        post_url: postUrl,
        like_count: Number(item.like_count || 0),
        comment_count: Number(item.comment_count || 0),
        hashtags: hashtags.join("|"),
        caption: truncate(caption, 240),
      });

      for (const hashtag of hashtags) {
        const current = hashtagMap.get(hashtag) || {
          hashtag,
          sellers: new Set(),
          post_count: 0,
          total_likes: 0,
          total_comments: 0,
          sample_posts: [],
        };

        current.sellers.add(seller);
        current.post_count += 1;
        current.total_likes += Number(item.like_count || 0);
        current.total_comments += Number(item.comment_count || 0);
        if (postUrl && current.sample_posts.length < 3) current.sample_posts.push(postUrl);
        hashtagMap.set(hashtag, current);
      }
    }

    console.log(`[miner] @${seller} 게시물 ${items.length}건, 해시태그 ${postRows.at(-1)?.hashtags ? "수집" : "없음"}`);
    await sleep(args.delayMs);
  }

  const hashtagRows = [...hashtagMap.values()]
    .map((row) => {
      const classified = classifyHashtag(row.hashtag);
      return {
        hashtag: row.hashtag,
        sellers_count: row.sellers.size,
        post_count: row.post_count,
        total_likes: row.total_likes,
        total_comments: row.total_comments,
        beauty_score: classified.beauty_score,
        selling_score: classified.selling_score,
        matched_beauty_keywords: classified.matched_beauty_keywords,
        matched_selling_keywords: classified.matched_selling_keywords,
        sample_sellers: [...row.sellers].join("|"),
        sample_posts: row.sample_posts.join("|"),
      };
    })
    .sort((a, b) => {
      return (
        b.sellers_count - a.sellers_count ||
        b.post_count - a.post_count ||
        b.beauty_score - a.beauty_score ||
        b.selling_score - a.selling_score ||
        b.total_comments - a.total_comments
      );
    });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const hashtagPath = path.join(args.outputDir, `instagram_seed_hashtags_${stamp}.csv`);
  const postsPath = path.join(args.outputDir, `instagram_seed_posts_${stamp}.csv`);
  const diagnosticsPath = path.join(args.outputDir, `instagram_seed_hashtag_diagnostics_${stamp}.json`);

  await fs.writeFile(
    hashtagPath,
    `\uFEFF${toCsv(hashtagRows, [
      "hashtag",
      "sellers_count",
      "post_count",
      "total_likes",
      "total_comments",
      "beauty_score",
      "selling_score",
      "matched_beauty_keywords",
      "matched_selling_keywords",
      "sample_sellers",
      "sample_posts",
    ])}\n`,
    "utf8"
  );
  await fs.writeFile(
    postsPath,
    `\uFEFF${toCsv(postRows, ["seller_name", "post_url", "like_count", "comment_count", "hashtags", "caption"])}\n`,
    "utf8"
  );
  await fs.writeFile(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`[done] hashtag ranking: ${hashtagPath}`);
  console.log(`[done] seed posts: ${postsPath}`);
  console.log(`[done] diagnostics: ${diagnosticsPath}`);
  console.log(`[done] unique hashtags: ${hashtagRows.length}`);
}

main().catch((error) => {
  console.error("[error]", error);
  process.exit(1);
});
