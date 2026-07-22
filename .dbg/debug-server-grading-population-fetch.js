const http = require("http");
const fs = require("fs");
const path = require("path");

const outdir = path.resolve(__dirname);
const logPath = path.join(outdir, "trae-debug-log-grading-population-fetch.ndjson");

fs.mkdirSync(outdir, { recursive: true });
if (!fs.existsSync(logPath)) {
  fs.writeFileSync(logPath, "");
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,GET,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/event") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        if (!parsed.ts) {
          parsed.ts = Date.now();
        }
        fs.appendFileSync(logPath, `${JSON.stringify(parsed)}\n`);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(400, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ ok: false, error: String(error) }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ ok: true, sessionId: "grading-population-fetch" }));
    return;
  }

  if (req.method === "DELETE" && req.url === "/logs") {
    fs.writeFileSync(logPath, "");
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

server.listen(7777, "127.0.0.1", () => {
  console.log("debug server http://127.0.0.1:7777/event");
});
