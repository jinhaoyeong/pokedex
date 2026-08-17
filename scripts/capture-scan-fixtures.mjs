import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { computeScanRuntimeFingerprint } from "./lib/scan-runtime-fingerprint.mjs";

const root = process.cwd();
const fixtureRoot = path.join(root, "data", "scan-fixtures");
const evidenceRoot = path.join(fixtureRoot, "evidence");
const manifest = JSON.parse(
  await readFile(path.join(fixtureRoot, "manifest.json"), "utf8"),
);
const fixtureArgument = process.argv.find((argument) =>
  argument.startsWith("--fixture="),
);
const requestedFixture = fixtureArgument?.slice("--fixture=".length) || null;
const fixtures = requestedFixture
  ? manifest.fixtures.filter((fixture) => fixture.fixture === requestedFixture)
  : manifest.fixtures;
if (!fixtures.length) {
  throw new Error(`Fixture is not present in manifest: ${requestedFixture}`);
}
const appUrl = process.env.SCAN_APP_URL || "http://localhost:3001/scan-debug";
const chromePath =
  process.env.CHROME_PATH ||
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find(existsSync);

if (!chromePath || !existsSync(chromePath)) {
  throw new Error(
    "Chrome was not found. Set CHROME_PATH to a Chrome/Chromium executable.",
  );
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(`${pending.method}: ${message.error.message || "CDP error"}`),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out connecting to Chrome")),
        10_000,
      );
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Chrome debugging socket failed"));
      });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForChrome(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome has not opened its debugging endpoint yet.
    }
    await delay(120);
  }
  throw new Error("Chrome did not start its debugging endpoint");
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (exceptionDetails) {
    throw new Error(
      exceptionDetails.exception?.description ||
        exceptionDetails.text ||
        "Browser evaluation failed",
    );
  }
  return result?.value;
}

async function waitForExpression(cdp, expression, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return;
    } catch {
      // Navigation/hot reload can briefly replace the execution context.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function buttonExpression(label, click = false) {
  const action = click ? "button.click();" : "";
  return `(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)},
    );
    if (!button) return false;
    ${action}
    return true;
  })()`;
}

async function clickButton(cdp, label) {
  const clicked = await evaluate(cdp, buttonExpression(label, true));
  if (!clicked) throw new Error(`Button not found: ${label}`);
}

async function setFixtureFile(cdp, fixturePath, source) {
  const { root: documentNode } = await cdp.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  const selector =
    source === "camera"
      ? 'input[type="file"][capture]'
      : 'input[type="file"]:not([capture])';
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: documentNode.nodeId,
    selector,
  });
  if (!nodeId) throw new Error(`File input not found for ${source}`);
  await cdp.send("DOM.setFileInputFiles", {
    nodeId,
    files: [fixturePath],
  });
}

async function saveScreenshot(cdp, filename) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(path.join(evidenceRoot, filename), Buffer.from(data, "base64"));
}

function captureSourceFor(fixture) {
  if (
    fixture.group === "clean_digital_english" ||
    fixture.group === "clean_digital_japanese" ||
    fixture.group === "black_letterboxed_digital" ||
    fixture.group === "psa_slab" ||
    fixture.group === "screenshot"
  ) {
    return "upload";
  }
  return "camera";
}

function sanitizedReportExpression() {
  return `(() => {
    const report = window.__POKEDEX_LAST_SCAN_DEBUG__;
    if (!report) return null;
    return JSON.parse(JSON.stringify(report, (key, value) =>
      key === "src" && typeof value === "string"
        ? "[embedded image omitted from sidecar]"
        : value
    ));
  })()`;
}

async function saveReportVariantImages(cdp, basename) {
  const variants = await evaluate(
    cdp,
    `(() => {
      const variants = window.__POKEDEX_LAST_SCAN_DEBUG__?.imageVariants ?? {};
      return Object.fromEntries(
        Object.entries(variants)
          .filter(([, value]) => typeof value?.src === "string")
          .map(([key, value]) => [key, value.src])
      );
    })()`,
  );
  for (const [key, source] of Object.entries(variants ?? {})) {
    const match = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(source);
    if (!match) continue;
    const extension = match[1] === "jpeg" ? "jpg" : "png";
    await writeFile(
      path.join(evidenceRoot, `${basename}-${key}.${extension}`),
      Buffer.from(match[2], "base64"),
    );
  }
}

await mkdir(evidenceRoot, { recursive: true });
const profileRoot = await mkdtemp(path.join(tmpdir(), "pokedex-scan-chrome-"));
const port = 9222 + Math.floor(Math.random() * 400);
let chromeStderr = "";
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileRoot}`,
    "--window-size=1280,1000",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
);
chrome.stderr.setEncoding("utf8");
chrome.stderr.on("data", (chunk) => {
  chromeStderr = `${chromeStderr}${chunk}`.slice(-12_000);
});

let cdp;
try {
  await waitForChrome(port);
  const pageResponse = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(appUrl)}`,
    { method: "PUT" },
  );
  if (!pageResponse.ok) {
    throw new Error(`Could not open fixture page (${pageResponse.status})`);
  }
  const page = await pageResponse.json();
  cdp = await CdpClient.connect(page.webSocketDebuggerUrl);
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("DOM.enable"),
  ]);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await waitForExpression(
    cdp,
    `(() => {
      if (document.querySelector('[role="dialog"]')) return true;
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === "Scan a card",
      );
      button?.click();
      return false;
    })()`,
    "the hydrated scanner dialog",
    75_000,
  );

  let completed = 0;
  for (const fixture of fixtures) {
    const fixturePath = path.join(fixtureRoot, fixture.fixture);
    const source = captureSourceFor(fixture);
    const basename = path.parse(fixture.fixture).name;
    const sidecarPath = path.join(
      fixtureRoot,
      `${fixture.fixture}.scan-debug.json`,
    );
    // Never let an interrupted rerun leave stale evidence looking current.
    await rm(sidecarPath, { force: true });
    const previousScanId = await evaluate(
      cdp,
      `window.__POKEDEX_LAST_SCAN_DEBUG__?.scanId ?? null`,
    );
    const startedAt = Date.now();
    console.log(`[scan:capture] ${fixture.fixture} (${source})`);

    try {
      const runtimeFingerprintBefore = computeScanRuntimeFingerprint(root);
      await setFixtureFile(cdp, fixturePath, source);
      await waitForExpression(
        cdp,
        buttonExpression("Scan this card"),
        `${fixture.fixture} crop stage`,
        30_000,
      );
      await saveScreenshot(cdp, `${basename}-crop.png`);
      await clickButton(cdp, "Scan this card");
      await waitForExpression(
        cdp,
        `Boolean(
          window.__POKEDEX_LAST_SCAN_DEBUG__?.durationMs != null &&
          window.__POKEDEX_LAST_SCAN_DEBUG__?.scanId !== ${JSON.stringify(previousScanId)} &&
          [...document.querySelectorAll("button")].some(
            (button) => button.textContent?.trim() === "Scan another"
          )
        )`,
        `${fixture.fixture} scan result`,
        150_000,
      );
      const report = await evaluate(cdp, sanitizedReportExpression());
      if (!report) throw new Error("Scanner did not publish a debug report");
      const runtimeFingerprintAfter = computeScanRuntimeFingerprint(root);
      if (runtimeFingerprintAfter.digest !== runtimeFingerprintBefore.digest) {
        throw new Error(
          "Scanner runtime sources changed while the fixture was being captured; rerun the fixture",
        );
      }
      await saveReportVariantImages(cdp, basename);
      const sidecar = {
        schemaVersion: 2,
        fixture: fixture.fixture,
        captureSource: source,
        recordedAt: new Date().toISOString(),
        wallClockDurationMs: Date.now() - startedAt,
        durationMs: report.durationMs,
        runtimeFingerprint: runtimeFingerprintBefore.digest,
        runtimeFingerprintFileCount: runtimeFingerprintBefore.files.length,
        report,
      };
      await writeFile(
        sidecarPath,
        `${JSON.stringify(sidecar, null, 2)}\n`,
        "utf8",
      );
      await saveScreenshot(cdp, `${basename}-result.png`);
      completed += 1;
      const top = report.finalRanking?.[0];
      console.log(
        `[scan:capture] result ${top?.cardId || "<uncertain>"} ` +
          `score=${top?.totalScore ?? "n/a"} duration=${Math.round(report.durationMs)}ms`,
      );
    } catch (error) {
      console.error(`[scan:capture] failed ${fixture.fixture}: ${error.message}`);
      const browserState = await evaluate(
        cdp,
        `(() => ({
          buttons: [...document.querySelectorAll("button")]
            .map((button) => button.textContent?.trim())
            .filter(Boolean),
          visibleTextTail: (document.body?.innerText || "").slice(-1800),
          publishedScanId: window.__POKEDEX_LAST_SCAN_DEBUG__?.scanId ?? null,
          debugPanel: document.querySelector(
            'pre[aria-label="Sanitized scan debug JSON"]'
          )?.textContent?.slice(0, 4000) ?? null,
        }))()`,
      ).catch(() => null);
      console.error(
        `[scan:capture] browser state ${JSON.stringify(browserState, null, 2)}`,
      );
      await saveScreenshot(cdp, `${basename}-failed.png`).catch(() => undefined);
    }

    if (fixture !== fixtures.at(-1)) {
      await waitForExpression(
        cdp,
        buttonExpression("Scan another"),
        "Scan another action",
        10_000,
      );
      await clickButton(cdp, "Scan another");
      await waitForExpression(
        cdp,
        `document.querySelectorAll('input[type="file"]').length === 2`,
        "scanner reset",
        10_000,
      );
    }
  }

  console.log(
    `[scan:capture] completed ${completed}/${fixtures.length} fixture reports`,
  );
  if (completed !== fixtures.length) process.exitCode = 2;
} catch (error) {
  console.error(`[scan:capture] fatal: ${error.stack || error.message}`);
  if (chromeStderr.trim()) {
    console.error(`[scan:capture] Chrome log tail:\n${chromeStderr.trim()}`);
  }
  process.exitCode = 2;
} finally {
  cdp?.close();
  chrome.kill();
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    delay(3_000),
  ]);
  const resolvedProfile = path.resolve(profileRoot);
  const resolvedTemp = path.resolve(tmpdir());
  if (
    path.dirname(resolvedProfile) === resolvedTemp &&
    path.basename(resolvedProfile).startsWith("pokedex-scan-chrome-")
  ) {
    await rm(resolvedProfile, { recursive: true, force: true }).catch(() => undefined);
  }
}
