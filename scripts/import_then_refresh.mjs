import { spawnSync } from "node:child_process";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    csvPath: "",
    cookie: process.env.IG_COOKIE || "",
    maxPosts: 20,
    intervalMs: 8000,
    limit: 80,
    withFallback: false,
    all: false,
    includeWithoutSellerId: false,
    skipAssign: false,
    assignLimit: 10000,
    skipOutOfRangeExclude: false,
  };

  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cookie") {
      args.cookie = argv[++i] || "";
    } else if (arg === "--max-posts") {
      args.maxPosts = Number(argv[++i]) || args.maxPosts;
    } else if (arg === "--interval-ms") {
      args.intervalMs = Number(argv[++i]) || args.intervalMs;
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]) || args.limit;
    } else if (arg === "--with-fallback") {
      args.withFallback = true;
    } else if (arg === "--all") {
      args.all = true;
    } else if (arg === "--include-without-seller-id") {
      args.includeWithoutSellerId = true;
    } else if (arg === "--skip-assign") {
      args.skipAssign = true;
    } else if (arg === "--assign-limit") {
      args.assignLimit = Number(argv[++i]) || args.assignLimit;
    } else if (arg === "--skip-out-of-range-exclude") {
      args.skipOutOfRangeExclude = true;
    } else if (arg.startsWith("--")) {
      console.log(`[warn] unknown option: ${arg}`);
    } else {
      rest.push(arg);
    }
  }

  if (rest.length) args.csvPath = rest[0];
  return args;
}

function run(script, args, label) {
  const p = path.join(process.cwd(), "scripts", script);
  const result = spawnSync(process.execPath, [p, ...args], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed (code ${result.status})`);
  }
}

function buildRefreshArgs(args) {
  const refreshArgs = [
    "--limit",
    String(args.limit),
    "--max-posts",
    String(args.maxPosts),
    "--interval-ms",
    String(args.intervalMs),
  ];

  if (args.cookie) {
    refreshArgs.push("--cookie", args.cookie);
  }
  if (args.all) {
    refreshArgs.push("--all");
  }
  if (args.withFallback || args.includeWithoutSellerId) {
    refreshArgs.push("--with-fallback");
  }
  if (args.includeWithoutSellerId) {
    refreshArgs.push("--with-fallback");
  }

  return refreshArgs;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csvPath) {
    throw new Error("Usage: node scripts/import_then_refresh.mjs <csv_path> [--cookie ...]");
  }

  console.log(`[pipeline] importing: ${args.csvPath}`);
  const importArgs = [args.csvPath];
  run("import_candidates_to_supabase.mjs", importArgs, "import");

  const refreshArgs = buildRefreshArgs(args);
  console.log(`[pipeline] refreshing engagement: ${refreshArgs.join(" ")}`);
  run("refresh_engagement_from_instagram.mjs", refreshArgs, "refresh");

  if (!args.skipAssign) {
    const assignArgs = ["--limit", String(args.assignLimit)];
    if (args.skipOutOfRangeExclude) {
      assignArgs.push("--skip-out-of-range-exclude");
    }
    console.log(`[pipeline] assigning candidates: ${assignArgs.join(" ")}`);
    run("assign_candidates.mjs", assignArgs, "assign");
  }
}

main();
