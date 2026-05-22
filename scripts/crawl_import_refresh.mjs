import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    hashtagFile: "data/cmo_top30_search_hashtags.txt",
    outputDir: "",
    limit: "",
    delayMs: 3000,
    cookie: process.env.IG_COOKIE || "",
    cookieFile: "",
    searchPages: "",
    searchPageDelayMs: "",
    requireBeauty: false,
    requireCommercial: false,
    prospectMode: false,
    refreshLimit: 120,
    maxPosts: 20,
    intervalMs: 8000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--hashtag-file") args.hashtagFile = argv[++i] || args.hashtagFile;
    else if (arg === "--output-dir") args.outputDir = argv[++i] || "";
    else if (arg === "--limit") args.limit = argv[++i] || "";
    else if (arg === "--delay-ms") args.delayMs = Number(argv[++i]) || args.delayMs;
    else if (arg === "--cookie") args.cookie = argv[++i] || "";
    else if (arg === "--cookie-file") args.cookieFile = argv[++i] || "";
    else if (arg === "--search-pages" || arg === "--pages") args.searchPages = Number(argv[++i]) || "";
    else if (arg === "--search-page-delay-ms" || arg === "--page-delay-ms") args.searchPageDelayMs = Number(argv[++i]) || "";
    else if (arg === "--require-beauty" || arg === "--beauty-only") args.requireBeauty = true;
    else if (arg === "--require-commercial" || arg === "--commercial-only") args.requireCommercial = true;
    else if (arg === "--prospect-mode") args.prospectMode = true;
    else if (arg === "--refresh-limit") args.refreshLimit = Number(argv[++i]) || args.refreshLimit;
    else if (arg === "--max-posts") args.maxPosts = Number(argv[++i]) || args.maxPosts;
    else if (arg === "--interval-ms") args.intervalMs = Number(argv[++i]) || args.intervalMs;
    else console.log(`[warn] unknown option: ${arg}`);
  }

  return args;
}

function readCookie(args) {
  if (args.cookie) return args.cookie;
  if (!args.cookieFile) return "";
  return fs.existsSync(args.cookieFile) ? fs.readFileSync(args.cookieFile, "utf8").trim() : "";
}

function run(script, args, label, { capture = false } = {}) {
  const scriptPath = path.join(process.cwd(), "scripts", script);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });

  if (capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (code ${result.status})`);
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function redactArgs(args) {
  const redacted = [];
  for (let i = 0; i < args.length; i += 1) {
    redacted.push(args[i]);
    if (args[i] === "--cookie") {
      i += 1;
      redacted.push("[redacted]");
    }
  }
  return redacted;
}

function buildCrawlerArgs(args) {
  const crawlerArgs = ["--hashtag-file", args.hashtagFile, "--delay-ms", String(args.delayMs)];
  if (args.outputDir) crawlerArgs.push("--output-dir", args.outputDir);
  if (args.limit) crawlerArgs.push("--limit", String(args.limit));
  if (args.searchPages) crawlerArgs.push("--search-pages", String(args.searchPages));
  if (args.searchPageDelayMs) crawlerArgs.push("--search-page-delay-ms", String(args.searchPageDelayMs));
  if (args.cookieFile) crawlerArgs.push("--cookie-file", args.cookieFile);
  else if (args.cookie) crawlerArgs.push("--cookie", args.cookie);
  if (args.requireBeauty) crawlerArgs.push("--require-beauty");
  if (args.requireCommercial) crawlerArgs.push("--require-commercial");
  if (args.prospectMode) crawlerArgs.push("--prospect-mode");
  return crawlerArgs;
}

function parseSummaryPath(output) {
  const match = output.match(/\[done\]\s+seller summary:\s+(.+)/);
  if (!match) throw new Error("Crawler completed but seller summary path was not found in output.");
  return path.resolve(process.cwd(), match[1].trim());
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cookie = readCookie(args);

  console.log("[pipeline] crawling with DB/excluded-handle blocking");
  const crawlerOutput = run("instagram_hashtag_crawler.mjs", buildCrawlerArgs(args), "crawl", { capture: true });
  const summaryPath = parseSummaryPath(crawlerOutput);

  console.log(`[pipeline] importing new candidates only: ${summaryPath}`);
  run("import_candidates_to_supabase.mjs", [summaryPath, "--skip-existing-db"], "import");

  const refreshArgs = [
    "--limit",
    String(args.refreshLimit),
    "--max-posts",
    String(args.maxPosts),
    "--interval-ms",
    String(args.intervalMs),
    "--only-missing-metrics",
    "--with-fallback",
  ];
  if (cookie) refreshArgs.push("--cookie", cookie);

  console.log(`[pipeline] refreshing missing engagement metrics: ${redactArgs(refreshArgs).join(" ")}`);
  run("refresh_engagement_from_instagram.mjs", refreshArgs, "refresh");
  console.log("[pipeline] done.");
}

main();
