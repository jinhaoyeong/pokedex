import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPriceChartingVgpcObject,
  parsePriceChartingEmbeddedPopulation,
  parsePriceChartingPublicPagePrices,
  parsePriceChartingPublicPageSales,
} from "../src/lib/market/pricecharting-provider";
import { buildMarketCardIdentity } from "../src/lib/market/card-identity";

test("nested VGPC pop_price_data is brace-matched instead of first closing brace", () => {
  const html = `VGPC.pop_price_data = {"psa":[0,0,0,0,0,0,0,1,2,9],"cgc":[],"meta":{"note":"} trap"},"prices":[0,0,0,0,0,0,0,100,200,300]};`;
  const raw = extractPriceChartingVgpcObject(html, "pop_price_data");
  assert.ok(raw);
  const parsed = JSON.parse(raw) as { psa: number[]; meta: { note: string } };
  assert.equal(parsed.psa[9], 9);
  assert.equal(parsed.meta.note, "} trap");

  const population = parsePriceChartingEmbeddedPopulation(html, "https://example.test");
  assert.equal(population?.grades.find((grade) => grade.grade === "PSA 10")?.count, 9);
});

test("product-page parsers stay fast on oversized HTML", () => {
  const padded = `${"x".repeat(200_000)}<tr>${"y".repeat(200_000)}`;
  const html = `Title: Giratina V #186 Prices | Pokemon Lost Origin | Pokemon Cards
${padded}
VGPC.pop_price_data = {"psa":[0,0,0,0,0,0,0,12,40,188],"cgc":[0,0,0,0,0,0,0,0,0,3],"prices":[]};
<table>
| Ungraded | Grade 7 | Grade 8 | Grade 9 | Grade 9.5 | PSA 10 |
| --- | --- | --- | --- | --- | --- |
| $690.00 -$1.00 | $400.00 | $520.00 | $890.00 | - | $2711.70 |
</table>
Sold Listings
| 2024-01-02 | extra | [Giratina V 186 Lost Origin](https://ebay.test/1) [eBay] | $900.00 |`;
  const identity = buildMarketCardIdentity({
    name: "Giratina V",
    setName: "Lost Origin",
    collectorNumber: "186",
    language: "en",
  });
  const started = Date.now();
  const prices = parsePriceChartingPublicPagePrices(html, "https://example.test/giratina");
  const sales = parsePriceChartingPublicPageSales(html, "https://example.test/giratina", identity);
  const population = parsePriceChartingEmbeddedPopulation(html, "https://example.test/giratina");
  const elapsedMs = Date.now() - started;

  assert.ok(elapsedMs < 250, `parsers took ${elapsedMs}ms on oversized HTML`);
  assert.ok(prices.some((price) => price.grade === "PSA 10" && price.value > 0));
  assert.equal(population?.grades.find((grade) => grade.grade === "PSA 10")?.count, 188);
  assert.equal(sales.length, 1);
});
