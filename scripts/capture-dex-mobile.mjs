#!/usr/bin/env node
/**
 * Phone-viewport screenshots of the Dex via CDP, used to check the mobile
 * layout redesign (pinned search bar, filter rail, option sheet).
 *
 *   BASE_URL=http://localhost:3000 OUT_DIR=/tmp/dexshots \
 *     node scripts/capture-dex-mobile.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CDP_URL = process.env.BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const OUT_DIR = process.env.OUT_DIR ?? "/tmp/dexshots";
const WIDTH = Number(process.env.SHOT_WIDTH ?? 390);
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 844);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openTarget(url) {
  const response = await fetch(`${CDP_URL}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(`CDP target creation failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function closeTarget(id) {
  await fetch(`${CDP_URL}/json/close/${id}`).catch(() => undefined);
}

function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (message) =>
        message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result),
      );
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { socket, send, ready };
}

async function capture({ name, url, steps = [] }) {
  const target = await openTarget(url);
  const { socket, send, ready } = connect(target.webSocketDebuggerUrl);
  await ready;

  try {
    await send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.navigate", { url });
    await sleep(Number(process.env.SHOT_SETTLE_MS ?? 7000));

    for (const step of steps) {
      await send("Runtime.evaluate", { expression: step.expression, awaitPromise: true });
      await sleep(step.waitMs ?? 900);
    }

    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = path.join(OUT_DIR, `${name}.png`);
    await fs.writeFile(file, Buffer.from(shot.data, "base64"));

    const metrics = await send("Runtime.evaluate", {
      expression: `(() => {
        const root = document.getElementById("app-scroll-root");
        const hero = document.querySelector(".dex-hero");
        const results = document.querySelector(".results-sheet");
        const rail = document.querySelector(".dex-quick-rail");
        const chips = document.querySelectorAll(".dex-quick-chip");
          const field = document.querySelector(".dex-search-input");
          const submit = document.querySelector(".dex-search-submit");
          const scan = document.querySelector(".dex-search-scan .scan-trigger");
          return JSON.stringify({
          scrollTop: root ? Math.round(root.scrollTop) : null,
          heroTop: hero ? Math.round(hero.getBoundingClientRect().top) : null,
          heroHeight: hero ? Math.round(hero.getBoundingClientRect().height) : null,
          resultsTop: results ? Math.round(results.getBoundingClientRect().top) : null,
          railVisible: rail ? getComputedStyle(rail).display !== "none" : false,
          chipCount: chips.length,
          chipLabels: [...chips].map((chip) => chip.textContent.trim()),
          chips: [...chips].map((chip) => {
            const value = chip.querySelector(".dex-quick-chip-value");
            const box = chip.getBoundingClientRect();
            return {
              key: chip.getAttribute("data-key"),
              w: Math.round(box.width),
              h: Math.round(box.height),
              x: Math.round(box.left),
              value: value?.textContent ?? "",
              overflow: Boolean(value && value.scrollWidth > value.clientWidth + 1),
            };
          }),
          search: field && submit ? {
            fieldH: Math.round(field.getBoundingClientRect().height),
            submitH: Math.round(submit.getBoundingClientRect().height),
            fieldY: Math.round(field.getBoundingClientRect().top),
            submitY: Math.round(submit.getBoundingClientRect().top),
            scanH: scan ? Math.round(scan.getBoundingClientRect().height) : null,
            fieldRight: Math.round(field.getBoundingClientRect().right),
            railRight: rail ? Math.round(rail.getBoundingClientRect().right) : null,
            submitRight: Math.round(submit.getBoundingClientRect().right),
          } : null,
          viewportHeight: window.innerHeight,
        });
      })()`,
      returnByValue: true,
    });

    console.log(name, metrics.result.value);
    return file;
  } finally {
    socket.close();
    await closeTarget(target.id);
  }
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const shots = JSON.parse(process.env.SHOTS ?? "[]");

  for (const shot of shots) {
    const file = await capture({
      name: shot.name,
      url: `${BASE_URL}${shot.path}`,
      steps: shot.steps ?? [],
    });
    console.log(`  → ${file}`);
  }
}

run().catch((error) => {
  console.error("capture failed", error);
  process.exit(1);
});
