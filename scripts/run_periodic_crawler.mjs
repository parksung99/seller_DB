import { spawn } from "node:child_process";

const DEFAULT_INTERVAL_MINUTES = 360;
const DEFAULT_PIPELINE_ARGS = [
  "--cookie-file",
  "ig_cookie.txt",
  "--delay-ms",
  "8000",
  "--limit",
  "20",
  "--refresh-limit",
  "120",
];

function parseArgs(argv) {
  const args = {
    intervalMinutes: Number(process.env.CRAWLER_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MINUTES,
    runImmediately: process.env.CRAWLER_RUN_IMMEDIATELY !== "0",
    pipelineArgs: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--interval-minutes") args.intervalMinutes = Number(argv[++i]) || args.intervalMinutes;
    else if (arg === "--no-immediate") args.runImmediately = false;
    else args.pipelineArgs.push(arg);
  }

  return args;
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

function timestamp() {
  return new Date().toISOString();
}

function runPipeline(pipelineArgs, signal) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/crawl_import_refresh.mjs", ...pipelineArgs], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    const stopChild = () => child.kill("SIGTERM");
    signal.addEventListener("abort", stopChild, { once: true });

    child.on("exit", (code, childSignal) => {
      signal.removeEventListener("abort", stopChild);
      resolve({ code, signal: childSignal });
    });

    child.on("error", (error) => {
      signal.removeEventListener("abort", stopChild);
      console.error(`[periodic-crawler] ${timestamp()} failed to start: ${error.message}`);
      resolve({ code: 1, signal: null });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pipelineArgs = args.pipelineArgs.length ? args.pipelineArgs : DEFAULT_PIPELINE_ARGS;
  const abortController = new AbortController();
  const { signal } = abortController;
  const intervalMs = Math.max(1, args.intervalMinutes) * 60 * 1000;

  const shutdown = () => {
    console.log(`[periodic-crawler] ${timestamp()} shutdown requested`);
    abortController.abort();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log(`[periodic-crawler] ${timestamp()} interval: ${args.intervalMinutes} minutes`);
  console.log(`[periodic-crawler] ${timestamp()} pipeline args: ${pipelineArgs.join(" ")}`);

  if (!args.runImmediately) {
    console.log(`[periodic-crawler] ${timestamp()} waiting before first run`);
    await sleep(intervalMs, signal);
  }

  while (!signal.aborted) {
    console.log(`[periodic-crawler] ${timestamp()} run started`);
    const result = await runPipeline(pipelineArgs, signal);

    if (signal.aborted) break;
    if (result.code === 0) console.log(`[periodic-crawler] ${timestamp()} run completed`);
    else console.error(`[periodic-crawler] ${timestamp()} run failed: code=${result.code} signal=${result.signal || ""}`);

    console.log(`[periodic-crawler] ${timestamp()} next run in ${args.intervalMinutes} minutes`);
    await sleep(intervalMs, signal);
  }

  console.log(`[periodic-crawler] ${timestamp()} stopped`);
}

main().catch((error) => {
  console.error(`[periodic-crawler] ${timestamp()} fatal: ${error.stack || error.message}`);
  process.exitCode = 1;
});
