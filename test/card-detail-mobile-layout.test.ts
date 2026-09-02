import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cssPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/app/styles/card-detail.css",
);
const css = fs.readFileSync(cssPath, "utf8");

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function declarationsIn(block: string) {
  return Object.fromEntries(
    block
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      }),
  );
}

function ruleBody(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stripComments(source).match(
    new RegExp(`${escaped}\\s*\\{([^}]+)\\}`),
  );
  assert.ok(match, `missing CSS rule for ${selector}`);
  return declarationsIn(match[1]);
}

test("phone card detail hides the 3-column catalog table", () => {
  const table = ruleBody(css, ".cd-facts:not(.cd-facts-compact)");
  assert.equal(table.display, "none");

  const compact = ruleBody(css, ".cd-facts-compact");
  assert.equal(compact.display, "grid");

  const base = ruleBody(css, ".cd-facts");
  assert.notEqual(base.display, "grid");
});

test("phone card detail places raw market under the art, before catalog copy", () => {
  assert.equal(ruleBody(css, ".cd-art-col").order, "1");
  assert.equal(ruleBody(css, ".cd-market-col").order, "2");
  assert.equal(ruleBody(css, ".cd-main").order, "3");

  const desktop = css.match(
    /@media \(min-width: 1024px\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(desktop, "missing 1024px card-body breakpoint");
  assert.match(
    desktop[1],
    /\.cd-art-col,\s*\.cd-main,\s*\.cd-market-col\s*\{\s*order:\s*0;/,
  );
});
