#!/usr/bin/env node
/**
 * Automated validation loop: run exhaustive set validation, analyze failures,
 * auto-tune timeouts, and repeat until all sets pass or max iterations reached.
 *
 * Usage:
 *   npm run validate:fix-loop
 *   VALIDATE_MAX_ITERATIONS=20 npm run validate:fix-loop
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(ROOT, process.env.VALIDATE_OUTPUT ?? "data/validate-set-prices-report.json");
const LOOP_LOG_PATH = path.join(ROOT, "data/validate-fix-loop.log");
const MAX_ITERATIONS = Number.parseInt(process.env.VALIDATE_MAX_ITERATIONS ?? "12", 10);
const BASE_URL = process.env.VALIDATE_BASE_URL ?? "http://localhost:3000";

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.mkdirSync(path.dirname(LOOP_LOG_PATH), { recursive: true });
  fs.appendFileSync(LOOP_LOG_PATH, `${line}\n`);
}

function runCommand(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });

    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function ensureServerReady() {
  try {
    const response = await fetch(`${BASE_URL}/api/search-sets?lang=en`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `App server not reachable at ${BASE_URL}. Start it with: npm run dev\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function analyzeFailures(report) {
  const codeCounts = new Map();
  const failedSets = [];

  for (const set of report.sets ?? []) {
    if (set.passed) {
      continue;
    }

    failedSets.push({
      language: set.language,
      setId: set.setId,
      name: set.name,
      failures: set.failures ?? [],
      error: set.error ?? null,
    });

    for (const failure of set.failures ?? []) {
      const key = `${failure.section ?? "unknown"}/${failure.code ?? "unknown"}`;
      codeCounts.set(key, (codeCounts.get(key) ?? 0) + 1);
    }

    if (set.error) {
      const key = "runtime/request_failed";
      codeCounts.set(key, (codeCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    failedCount: report.failedCount ?? failedSets.length,
    passedCount: report.passedCount ?? 0,
    setCount: report.setCount ?? report.sets?.length ?? 0,
    codeCounts: Object.fromEntries(codeCounts),
    failedSets,
  };
}

function buildIterationEnv(analysis, iteration) {
  const env = {
    VALIDATE_MODE: "exhaustive",
    VALIDATE_LANG: "all",
    VALIDATE_GRADING_MARKET: "true",
    VALIDATE_INCREMENTAL_REPORT: "true",
    VALIDATE_OUTPUT: path.relative(ROOT, REPORT_PATH),
  };

  const timeoutBump = (iteration - 1) * 30_000;
  const requestFailures = analysis.codeCounts["runtime/request_failed"] ?? 0;

  if (requestFailures > 0 || iteration > 1) {
    env.VALIDATE_SET_TIMEOUT_MS = String(120_000 + timeoutBump);
    env.VALIDATE_DETAIL_TIMEOUT_MS = String(90_000 + timeoutBump);
    env.VALIDATE_GRADING_TIMEOUT_MS = String(120_000 + timeoutBump);
  }

  if ((analysis.codeCounts["cardDetail/detail_request_failed"] ?? 0) > 0) {
    env.VALIDATE_DETAIL_TIMEOUT_MS = String(120_000 + timeoutBump);
  }

  return env;
}

function printFailureSummary(analysis) {
  log(
    `Result: ${analysis.passedCount}/${analysis.setCount} passed, ${analysis.failedCount} failed`,
  );

  if (!analysis.failedCount) {
    return;
  }

  log("Failure breakdown:");
  for (const [code, count] of Object.entries(analysis.codeCounts).sort((a, b) => b[1] - a[1])) {
    log(`  ${code}: ${count}`);
  }

  log("Failed sets (first 25):");
  for (const set of analysis.failedSets.slice(0, 25)) {
    const codes = (set.failures ?? []).map((f) => f.code).join(", ") || set.error || "unknown";
    log(`  ${set.language}/${set.setId} (${set.name ?? ""}) — ${codes}`);
  }
}

async function main() {
  fs.mkdirSync(path.dirname(LOOP_LOG_PATH), { recursive: true });
  fs.writeFileSync(LOOP_LOG_PATH, "");

  log(`Starting validate-fix loop (max ${MAX_ITERATIONS} iterations)`);
  await ensureServerReady();

  let lastAnalysis = null;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    log(`=== Iteration ${iteration}/${MAX_ITERATIONS} ===`);

    const env =
      iteration === 1
        ? buildIterationEnv({ codeCounts: {} }, iteration)
        : buildIterationEnv(lastAnalysis ?? { codeCounts: {} }, iteration);

    log(`Running validation with env: ${JSON.stringify(env)}`);

    const exitCode = await runCommand("node", ["scripts/validate-set-prices.mjs"], env);

    if (!fs.existsSync(REPORT_PATH)) {
      log("Validation report missing; aborting loop.");
      process.exitCode = 1;
      return;
    }

    const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
    const analysis = analyzeFailures(report);
    lastAnalysis = analysis;

    printFailureSummary(analysis);

    if (analysis.failedCount === 0) {
      log("All sets passed validation.");
      process.exitCode = 0;
      return;
    }

    log(`Iteration ${iteration} finished with exit code ${exitCode}.`);

    if (iteration === MAX_ITERATIONS) {
      log(`Reached max iterations (${MAX_ITERATIONS}) with ${analysis.failedCount} failing set(s).`);
      process.exitCode = 1;
      return;
    }

    log("Preparing next iteration with adjusted timeouts and awaiting code fixes if needed...");
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
