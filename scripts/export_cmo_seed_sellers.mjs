import fs from "node:fs/promises";

const FIRESTORE_PROJECT_ID = "gugu-influencer-db-153f2";
const FIRESTORE_API_KEY = "AIzaSyCIGTOJTdUG1WPCYMmjgOU9KL23bnZDxxw";
const OUTPUT_FILE = "seed_sellers.txt";
const SNAPSHOT_FILE = "data/cmo_seed_sellers_snapshot.json";

function fieldValue(field) {
  if (!field) return "";
  return field.stringValue ?? field.integerValue ?? field.doubleValue ?? field.timestampValue ?? "";
}

function normalizeHandle(value) {
  return String(value || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
}

function handleFromInstagramUrl(url) {
  const match = String(url || "").match(/instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/)([A-Za-z0-9._]+)/);
  return match ? normalizeHandle(match[1]) : "";
}

async function fetchInfluencers() {
  let pageToken = "";
  const documents = [];

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/influencers`
    );
    url.searchParams.set("pageSize", "300");
    url.searchParams.set("key", FIRESTORE_API_KEY);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url);
    const json = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(json));
    }

    documents.push(...(json.documents || []));
    pageToken = json.nextPageToken || "";
  } while (pageToken);

  return documents;
}

async function main() {
  await fs.mkdir("data", { recursive: true });

  const documents = await fetchInfluencers();
  const rows = documents
    .map((document) => {
      const fields = document.fields || {};
      const handle = normalizeHandle(fieldValue(fields.handle)) || handleFromInstagramUrl(fieldValue(fields.instaUrl));

      return {
        nickname: fieldValue(fields.nickname),
        handle,
        category: fieldValue(fields.category),
        platform: fieldValue(fields.platform),
        followers: fieldValue(fields.followers),
        status: fieldValue(fields.status),
        instaUrl: fieldValue(fields.instaUrl),
      };
    })
    .filter((row) => row.handle);

  const uniqueRows = [...new Map(rows.map((row) => [row.handle, row])).values()].sort((a, b) =>
    a.handle.localeCompare(b.handle)
  );

  await fs.writeFile(OUTPUT_FILE, `${uniqueRows.map((row) => row.handle).join("\n")}\n`, "utf8");
  await fs.writeFile(SNAPSHOT_FILE, `${JSON.stringify(uniqueRows, null, 2)}\n`, "utf8");

  console.log(`[done] exported handles: ${uniqueRows.length}`);
  console.log(`[done] seed file: ${OUTPUT_FILE}`);
  console.log(`[done] snapshot: ${SNAPSHOT_FILE}`);
}

main().catch((error) => {
  console.error("[error]", error);
  process.exit(1);
});
