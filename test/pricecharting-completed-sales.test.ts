import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildMarketCardIdentity } from "../src/lib/market/card-identity";
import {
  matchPriceChartingSaleTitle,
  parsePriceChartingPublicPageSalesDetailed,
} from "../src/lib/market/pricecharting-provider";
import { mergeAttributedSoldComps } from "../src/lib/psa-population";
import type { SaleRecord } from "../src/types/pokemon";

const JAPANESE_SOURCE_URL =
  "https://www.pricecharting.com/game/pokemon-japanese-mega-dream-ex/mega-gengar-ex-230";

const japaneseIdentity = buildMarketCardIdentity({
  language: "ja",
  name: "メガゲンガーex",
  englishName: "Mega Gengar ex",
  setName: "ハイクラスパック MEGAドリームex",
  setEnglishName: "MEGA Dream ex",
  setCode: "M2A",
  collectorNumber: "230",
  setPrintedTotal: 193,
});

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

test("Japanese completed-sale titles accept exact, zero-padded, and full-width collector numbers", () => {
  for (const title of [
    "Mega Gengar ex #230 Japanese M2A PSA 10",
    "Mega Gengar ex #00230 Japanese M2A",
    "Mega Gengar ex ＃０２３０ Japanese M2A",
  ]) {
    assert.deepEqual(matchPriceChartingSaleTitle(japaneseIdentity, title), {
      matched: true,
      reasons: [],
    });
  }
});

test("Japanese completed-sale parsing accepts only exact identity and reports each conflict", () => {
  const result = parsePriceChartingPublicPageSalesDetailed(
    fixture("pricecharting-completed-sales.html"),
    JAPANESE_SOURCE_URL,
    japaneseIdentity,
  );

  assert.equal(result.candidateCount, 6);
  assert.deepEqual(
    result.sales.map((sale) => ({
      date: sale.date,
      title: sale.title,
      condition: sale.condition,
      price: sale.price,
      source: sale.source,
    })),
    [
      {
        date: "2026-07-18",
        title: "Mega Gengar ex #230 Japanese M2A PSA 10",
        condition: "PSA 10",
        price: 155,
        source: "PriceCharting completed eBay sales",
      },
      {
        date: "2026-07-15",
        title: "Mega Gengar ex #0230 Japanese M2A",
        condition: "Ungraded",
        price: 14.25,
        source: "PriceCharting completed eBay sales",
      },
    ],
  );
  assert.deepEqual(result.rejectedReasonCounts, {
    identity_collector_mismatch: 1,
    identity_name_mismatch: 1,
    identity_set_mismatch: 1,
    identity_language_mismatch: 1,
  });
});

test("explicit conflicting set labels are rejected while an omitted set remains acceptable", () => {
  assert.deepEqual(
    matchPriceChartingSaleTitle(
      japaneseIdentity,
      "Mega Gengar ex #230 Japanese | set: Ruler of the Black Flame",
    ),
    { matched: false, reasons: ["identity_set_mismatch"] },
  );
  assert.deepEqual(
    matchPriceChartingSaleTitle(japaneseIdentity, "Mega Gengar ex #230 Japanese"),
    { matched: true, reasons: [] },
  );
});

test("English completed-sale parsing remains unchanged as a control", () => {
  const identity = buildMarketCardIdentity({
    language: "en",
    name: "Charizard",
    setName: "Base Set",
    setEnglishName: "Base Set",
    setCode: "BS",
    collectorNumber: "4",
    setPrintedTotal: 102,
  });
  const html = `
    <table>
      <tr>
        <td class="date">2026-07-10</td>
        <td class="title"><a href="https://www.ebay.com/itm/123456789007">Charizard #004 English PSA 9</a></td>
        <td>eBay</td>
        <td><span class="js-price">$1,234.56</span></td>
      </tr>
      <tr>
        <td class="date">2026-07-09</td>
        <td class="title"><a href="https://www.ebay.com/itm/123456789008">Charizard #4 Japanese PSA 9</a></td>
        <td>eBay</td>
        <td><span class="js-price">$999.00</span></td>
      </tr>
    </table>`;

  const result = parsePriceChartingPublicPageSalesDetailed(
    html,
    "https://www.pricecharting.com/game/pokemon-base-set/charizard-4",
    identity,
  );

  assert.equal(result.candidateCount, 2);
  assert.equal(result.sales.length, 1);
  assert.equal(result.sales[0]?.title, "Charizard #004 English PSA 9");
  assert.equal(result.sales[0]?.price, 1234.56);
  assert.equal(result.rejectedReasonCounts.identity_language_mismatch, 1);
});

test("sold-comp hygiene rejects signed, metal promo, and cracked slab titles", () => {
  const identity = buildMarketCardIdentity({
    language: "en",
    name: "Charizard",
    setName: "Base Set",
    setEnglishName: "Base Set",
    setCode: "BS",
    collectorNumber: "4",
    setPrintedTotal: 102,
  });
  const celebrations = buildMarketCardIdentity({
    language: "en",
    name: "Charizard",
    setName: "Celebrations: Classic Collection",
    setEnglishName: "Celebrations",
    setCode: "CEL25C",
    collectorNumber: "4",
    setPrintedTotal: 25,
  });
  const japaneseMew = buildMarketCardIdentity({
    language: "ja",
    name: "ミュウex",
    englishName: "Mew ex",
    setName: "ポケモンカード151",
    setEnglishName: "Pokemon Card 151",
    setCode: "SV2A",
    collectorNumber: "205",
    setPrintedTotal: 165,
  });

  assert.deepEqual(
    matchPriceChartingSaleTitle(
      identity,
      "LOGAN PAUL SIGNED - 1999 POKEMON BASE SET UNLIMITED #4 CHARIZARD HOLO PSA 9",
    ),
    { matched: false, reasons: ["junk_signed_autograph"] },
  );
  assert.deepEqual(
    matchPriceChartingSaleTitle(
      celebrations,
      "Pokemon Gold Metal Charizard Trading Card Celebrations Promo UPC 4/102 LP *Read! 004/102",
    ),
    { matched: false, reasons: ["junk_metal_jumbo_promo"] },
  );
  assert.deepEqual(
    matchPriceChartingSaleTitle(
      japaneseMew,
      "Pokemon TCG Mew ex 205/165 SV2a Card 151 Japanese SAR Holo PSA 10. Slight Crack Japanese 205/165",
    ),
    { matched: false, reasons: ["junk_damaged_slab"] },
  );
  assert.deepEqual(
    matchPriceChartingSaleTitle(
      celebrations,
      "Pokemon TCG Charizard 4/102 Holo Rare Celebrations 25th Anniversary Mint 4/102",
    ),
    { matched: true, reasons: [] },
  );
});

test("merge drops cached PriceCharting junk titles even when Magery kept a short listing", () => {
  const magerySale: SaleRecord = {
    date: "2026-08-10",
    title: "Pokemon Charizard Celebrations 4/102 PSA 10",
    condition: "PSA 10",
    price: 40,
    source: "Magery public sold comps",
    listingUrl: "https://www.ebay.com/itm/111111111111",
    evidenceType: "sold_comp",
    confidence: "medium",
    confidenceScore: 0.65,
  };
  const junkPriceChartingSale: SaleRecord = {
    date: "2026-08-10",
    title:
      "Pokemon Gold Metal Charizard Trading Card Celebrations Promo UPC 4/102 LP *Read! 004/102",
    condition: "Ungraded",
    price: 12,
    source: "PriceCharting completed eBay sales",
    listingUrl: "https://www.ebay.com/itm/222222222222",
    sourceUrl: "https://www.pricecharting.com/game/pokemon-celebrations/charizard-4",
    evidenceType: "sold_comp",
    confidence: "medium",
    confidenceScore: 0.72,
  };

  const merged = mergeAttributedSoldComps([magerySale], [junkPriceChartingSale], {
    cardName: "Charizard",
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.title, magerySale.title);
});

test("attributed PriceCharting sales replace duplicate Magery listings by canonical eBay item id", () => {
  const magerySale: SaleRecord = {
    date: "2026-07-18",
    title: "Mega Gengar ex Japanese #230 PSA 10",
    condition: "PSA 10",
    price: 155,
    source: "Magery",
    listingUrl:
      "https://www.ebay.com/itm/mega-gengar/123456789012?utm_source=magery",
    evidenceType: "sold_comp",
    confidence: "medium",
    confidenceScore: 0.65,
  };
  const priceChartingSale: SaleRecord = {
    ...magerySale,
    source: "PriceCharting completed eBay sales",
    listingUrl: "https://ebay.com/itm/123456789012?campid=pricecharting",
    sourceUrl: JAPANESE_SOURCE_URL,
    confidenceScore: 0.72,
  };

  const merged = mergeAttributedSoldComps([magerySale], [priceChartingSale]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.source, "PriceCharting completed eBay sales");
  assert.equal(merged[0]?.listingUrl, priceChartingSale.listingUrl);
});
