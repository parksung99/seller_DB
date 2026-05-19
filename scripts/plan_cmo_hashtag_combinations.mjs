import fs from "node:fs/promises";
import path from "node:path";

const INPUT = "data/cmo_db_influencer_hashtag_ranking.csv";
const OUTPUT_PLAN = "data/cmo_top30_hashtag_plan.csv";
const OUTPUT_SEARCH_TAGS = "data/cmo_top30_search_hashtags.txt";
const TOP_N = 30;

const CATEGORY_TAGS = new Set([
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
  "피부관리",
  "세럼추천",
  "뷰티크리에이터",
  "뷰티꿀팁",
  "클린메이크업",
  "코랄메이크업",
  "뮤트립추천",
  "모공앰플",
  "하이라이터",
]);

const COMMERCIAL_TAGS = new Set(["광고", "협찬", "제품제공", "ad", "추천", "댓글이벤트", "이벤트"]);
const FORMAT_TAGS = new Set(["fyp", "pov", "transition", "makeuptutorial", "공감"]);
const WEAK_SEARCH_TAGS = new Set(["광고", "협찬", "제품제공", "ad", "fyp", "pov", "transition", "공감", "댓글이벤트", "이벤트"]);

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
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

function roleForTag(tag) {
  if (CATEGORY_TAGS.has(tag)) return "search";
  if (COMMERCIAL_TAGS.has(tag)) return "commercial_signal";
  if (FORMAT_TAGS.has(tag)) return "format_signal";
  if (WEAK_SEARCH_TAGS.has(tag)) return "weak_signal";
  return "review";
}

function reasonForTag(tag, role) {
  if (role === "search") return "뷰티 카테고리 또는 뷰티 콘텐츠 포맷이 명확해서 검색용";
  if (role === "commercial_signal") return "광고/협찬/추천 신호라 단독 검색보다 점수 계산용";
  if (role === "format_signal") return "바이럴/숏폼 포맷 신호라 뷰티 앵커와 함께 있을 때만 강함";
  if (role === "weak_signal") return "범위가 넓어 단독 검색 시 노이즈 큼";
  return "상위 태그지만 수동 검토 필요";
}

async function main() {
  await fs.mkdir(path.dirname(OUTPUT_PLAN), { recursive: true });

  const text = (await fs.readFile(INPUT, "utf8")).replace(/^\uFEFF/, "");
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine);
  const hashtagIndex = headers.indexOf("hashtag");

  const rows = lines.slice(0, TOP_N).map((line, index) => {
    const cells = parseCsvLine(line);
    const hashtag = cells[hashtagIndex];
    const role = roleForTag(hashtag);

    return {
      rank: index + 1,
      hashtag,
      role,
      use_for_search: role === "search" ? "yes" : "no",
      use_for_scoring: role === "search" || role.endsWith("_signal") || role === "commercial_signal" ? "yes" : "review",
      reason: reasonForTag(hashtag, role),
    };
  });

  const searchTags = rows.filter((row) => row.use_for_search === "yes").map((row) => row.hashtag);

  await fs.writeFile(
    OUTPUT_PLAN,
    `\uFEFF${toCsv(rows, ["rank", "hashtag", "role", "use_for_search", "use_for_scoring", "reason"])}\n`,
    "utf8"
  );
  await fs.writeFile(OUTPUT_SEARCH_TAGS, `${searchTags.join("\n")}\n`, "utf8");

  console.log(`[done] plan: ${OUTPUT_PLAN}`);
  console.log(`[done] search tags: ${OUTPUT_SEARCH_TAGS}`);
  console.log(`[done] top tags: ${rows.length}`);
  console.log(`[done] search tags count: ${searchTags.length}`);
}

main().catch((error) => {
  console.error("[error]", error);
  process.exit(1);
});
