import Module from "node:module";
import type { PriceQuery } from "../src/lib/price/types";

const require = Module.createRequire(import.meta.url);
const originalResolveFilename = (Module as unknown as { _resolveFilename: Function })._resolveFilename;
(Module as unknown as { _resolveFilename: Function })._resolveFilename = function resolveFilename(
  request: string,
  ...args: unknown[]
) {
  if (request === "server-only") {
    return require.resolve("../node_modules/next/dist/compiled/server-only/empty.js");
  }

  return originalResolveFilename.call(this, request, ...args);
};

const query: PriceQuery = {
  slug: "ja--official-201-charizard-ex-sv2a",
  language: "ja",
  name: "リザードンex",
  englishName: "Charizard ex",
  setCode: "SV2a",
  setName: "ポケモンカード151",
  setEnglishName: "Pokemon Card 151",
  collectorNumber: "201/165",
  rarity: "Localized release",
};

const mockCollectrPayload = {
  data: [
    {
      product_id: "collectr-sv2a-201",
      catalog_category_name: "Pokemon",
      catalog_group: "Pokemon Card 151 Japanese SV2a",
      set: {
        name: "Pokemon Card 151",
      },
      product_name: "Charizard ex",
      card_number: "201/165",
      rarity: "Special Illustration Rare",
      is_card: true,
      latest_price: 399.99,
      market_price: 399.99,
      prices: {
        market: 399.99,
        ungraded: 399.99,
        psa10: 899.95,
        psa9: 579.5,
        psa8: 429,
      },
      graded_prices: [
        {
          service: "PSA",
          grade: "PSA 10",
          market_price: 899.95,
        },
        {
          service: "PSA",
          grade: "PSA 9",
          market_price: 579.5,
        },
        {
          service: "PSA",
          grade: "PSA 8",
          market_price: 429,
        },
      ],
      recent_sales: [
        {
          date: "2026-07-02",
          title: "Charizard ex 201/165 SV2a Pokemon 151 Japanese SIR",
          condition: "Ungraded",
          price: 387.25,
          marketplace: "eBay",
          url: "https://www.ebay.com/itm/mock-charizard-sv2a-201",
        },
      ],
    },
    {
      product_id: "collectr-sv2a-006",
      catalog_category_name: "Pokemon",
      catalog_group: "Pokemon Card 151 Japanese SV2a",
      product_name: "Charizard ex",
      card_number: "006/165",
      is_card: true,
      latest_price: 14.25,
    },
  ],
};

async function main() {
  const { collectrMatchDebug } = await import("../src/lib/price/collectr-fallback");
  const debug = collectrMatchDebug(query, mockCollectrPayload);
  const result = debug.providerResult;
  const psa10 = result?.gradedPrices?.find((price) => price.grade === "PSA 10")?.value ?? null;
  const psa9 = result?.gradedPrices?.find((price) => price.grade === "PSA 9")?.value ?? null;
  const psa8 = result?.gradedPrices?.find((price) => price.grade === "PSA 8")?.value ?? null;

  console.log("Collectr parser mock verification");
  console.log(`Query variants: ${debug.variants.join(" | ")}`);

  for (const candidate of debug.candidates) {
    console.log(
      `Candidate: ${candidate.normalized.name} #${candidate.normalized.number} / ${candidate.normalized.set} -> score ${candidate.score}, raw ${candidate.value}`,
    );
  }

  if (debug.best) {
    console.log(
      `Match found: ${query.englishName} (${query.setCode} #${query.collectorNumber?.split("/")[0]}) === Collectr Result: ${debug.best.normalized.name} #${debug.best.normalized.number}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        marketPrice: result?.ungradedUsd ?? null,
        ungraded: result?.ungradedUsd ?? null,
        psa10,
        psa9,
        psa8,
        soldComps: result?.sales ?? [],
        providerResult: result,
      },
      null,
      2,
    ),
  );
}

void main();
