import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.BROWSER_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const debugUrl = process.env.BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const artifactDir = path.resolve(
  process.env.BROWSER_ARTIFACT_DIR ?? "test-results/japanese-market-verification",
);
const cards = [
  { slug: "ja--official-49990", language: "ja", collectorNumber: "230" },
  { slug: "ja--official-50000", language: "ja", collectorNumber: "240" },
  { slug: "en--sv4-198", language: "en", collectorNumber: "198" },
  { slug: "en--sv8-247", language: "en", collectorNumber: "247" },
];

await fs.mkdir(artifactDir, { recursive: true });

async function openTarget(url) {
  const response = await fetch(`${debugUrl}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`CDP target creation failed: HTTP ${response.status}`);
  return response.json();
}

async function runCard(card) {
  const target = await openTarget(`${baseUrl}/cards/${card.slug}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const events = { requests: [], responses: [], console: [], exceptions: [], failed: [] };
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Network.requestWillBeSent") events.requests.push(message.params);
    if (message.method === "Network.responseReceived") events.responses.push(message.params);
    if (message.method === "Network.loadingFailed") events.failed.push(message.params);
    if (message.method === "Runtime.consoleAPICalled") events.console.push(message.params);
    if (message.method === "Runtime.exceptionThrown") events.exceptions.push(message.params);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (message) => (message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message)));
      socket.send(JSON.stringify({ id, method, params }));
    });

  await call("Network.enable");
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Page.navigate", { url: `${baseUrl}/cards/${card.slug}` });
  let ui;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const evaluated = await call("Runtime.evaluate", {
      expression: `JSON.stringify({
        ready: document.documentElement.classList.contains("app-ready"),
        splash: Boolean(document.querySelector(".app-boot-splash")),
        collector: document.body.innerText.match(/#\\d+/)?.[0] ?? null,
        body: document.body.innerText.slice(0, 14000),
      })`,
      returnByValue: true,
    });
    ui = JSON.parse(evaluated.result.result.value);
    if (ui.ready && !ui.splash && ui.collector) break;
  }

  const relevant = (url) => /\/api\/(bootstrap|cards|price|grading-market)/.test(url);
  const requests = events.requests.filter((event) => relevant(event.request.url));
  const responses = events.responses.filter((event) => relevant(event.response.url));
  const marketRequests = requests.filter((event) => /\/api\/(price|grading-market)/.test(event.request.url));
  const marketResponses = responses.filter((event) => /\/api\/(price|grading-market)/.test(event.response.url));
  const consoleErrors = events.console.filter((event) => ["error", "assert"].includes(event.type));
  const result = {
    card,
    ui: { ready: ui.ready, splash: ui.splash, collector: ui.collector, hasIdentity: /Identity: Verified/.test(ui.body) },
    requests: requests.map((event) => event.request.url),
    responses: marketResponses.map((event) => ({ url: event.response.url, status: event.response.status })),
    consoleErrors: consoleErrors.map((event) => event.args.map((arg) => arg.value ?? arg.description).join(" ")),
    exceptions: events.exceptions.map((event) => event.exceptionDetails.text),
    failed: events.failed.map((event) => event.errorText),
  };

  const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }).catch(() => null);
  if (screenshot?.result?.data) {
    await fs.writeFile(path.join(artifactDir, `${card.slug}.png`), Buffer.from(screenshot.result.data, "base64"));
  }
  await fs.writeFile(path.join(artifactDir, `${card.slug}.json`), `${JSON.stringify(result, null, 2)}\n`);
  socket.close();

  if (!ui.ready || ui.splash || ui.collector !== `#${card.collectorNumber}` || !marketRequests.length || marketResponses.some((response) => response.status < 200 || response.status >= 500) || result.consoleErrors.length || result.exceptions.length) {
    throw new Error(`Browser smoke failed for ${card.slug}: ${JSON.stringify(result)}`);
  }
  if (card.language === "ja" && !marketRequests.every((event) => {
    const url = event.request.url;
    return url.includes("officialCardId=") && (url.includes(`number=${card.collectorNumber}`) || url.includes(`cardNumber=${card.collectorNumber}`));
  })) {
    throw new Error(`Japanese identity was not preserved for ${card.slug}`);
  }
  if (card.language === "en" && marketRequests.some((event) => event.request.url.includes("officialCardId="))) {
    throw new Error(`English request unexpectedly included Japanese officialCardId for ${card.slug}`);
  }
  return result;
}

const results = [];
for (const card of cards) results.push(await runCard(card));
await fs.writeFile(path.join(artifactDir, "run.json"), `${JSON.stringify({ baseUrl, finishedAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(JSON.stringify({ baseUrl, cards: results.map((result) => result.card.slug), artifactDir }, null, 2));
