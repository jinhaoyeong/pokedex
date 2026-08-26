import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogFactCompleteness,
  shouldKeepCurrentCatalogCard,
} from "../src/lib/card-detail-catalog-merge";
import {
  resolveGradingMarketLookupCardName,
  sanitizePartialPreviewMarketCard,
} from "../src/lib/grading-market-lookup";
import { deriveIdentityStatus } from "../src/lib/card-confidence";
import { buildPriceLookupParams } from "../src/lib/price/price-query";
import type { TcgCard } from "../src/types/pokemon";

function grailLike(overrides: Partial<TcgCard> = {}): TcgCard {
  return {
    id: "swsh7-215",
    slug: "swsh7-215",
    language: "en",
    languageLabel: "English",
    name: "Umbreon VMAX Alternate Art",
    collectorNumber: "215",
    rarity: "Secret Rare Alternate Art",
    supertype: "Pokemon",
    hp: "310",
    types: ["Darkness"],
    setId: "swsh7",
    setCode: "EVS",
    setName: "Evolving Skies",
    image: "https://images.pokemontcg.io/swsh7/215_hires.png",
    artist: "KEIICHIRO ITO",
    marketPriceUsd: 1450,
    psaPopulation: {
      status: "verified",
      totalCertified: 240,
      grades: [
        { grade: "PSA 10", count: 80 },
        { grade: "PSA 9", count: 108 },
      ],
      source: "Static grail preview model",
      fetchedAt: "2026-05-10T08:00:00.000Z",
      note: "Bundled premium preview record for instant homepage rendering.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [{ date: "2026-05-10", value: 1450 }],
    gradedPrices: [
      { grade: "Ungraded", value: 1450, source: "Static grail preview model" },
      { grade: "PSA 10", value: 3045, source: "Static grail preview model" },
    ],
    recentSales: [
      {
        date: "2026-05-09",
        title: "preview sale",
        condition: "PSA 9",
        price: 2100,
        source: "Premium preview composite",
      },
    ],
    sources: [
      {
        source: "Bundled grail preview catalog",
        status: "estimated",
        fetchedAt: "2026-05-10T08:00:00.000Z",
        confidence: 0.86,
        note: "Static launch value curated for the premium homepage showcase.",
      },
      {
        source: "TCGdex",
        status: "verified",
        fetchedAt: "2026-08-16T00:00:00.000Z",
        confidence: 0.84,
        note: "Print facts hydrated from the live TCGdex catalog.",
      },
    ],
    ...overrides,
  } as TcgCard;
}

test("homepage stash without print facts is replaced by the hydrated catalog card", () => {
  const stashed = grailLike();
  const hydrated = grailLike({
    englishName: "Umbreon VMAX",
    stage: "VMAX",
    dexIds: [197],
    setPrintedTotal: 203,
    setTotal: 237,
    attacks: [{ name: "Max Darkness", damage: "160" }],
  });

  assert.ok(catalogFactCompleteness(hydrated) > catalogFactCompleteness(stashed));
  assert.equal(shouldKeepCurrentCatalogCard(stashed, hydrated), false);
});

test("market lookup strips Alternate Art so PriceCharting can match the print", () => {
  const card = grailLike();
  assert.equal(resolveGradingMarketLookupCardName(card), "Umbreon VMAX");
  assert.equal(buildPriceLookupParams(card).get("name"), "Umbreon VMAX");
  assert.equal(buildPriceLookupParams(card).get("englishName"), "Umbreon VMAX");
});

test("preview sanitize keeps live catalog sources and drops fake pop", () => {
  const sanitized = sanitizePartialPreviewMarketCard(grailLike());
  assert.equal(sanitized.psaPopulation.grades.length, 0);
  assert.equal(sanitized.recentSales.length, 0);
  assert.ok(sanitized.sources.some((source) => source.source === "TCGdex"));
  assert.equal(
    sanitized.sources.some((source) => /grail preview/i.test(source.source)),
    false,
  );
  assert.equal(sanitized.marketPriceUsd, 0);
});

test("complete print facts verify identity even after preview sources are stripped", () => {
  const sanitized = sanitizePartialPreviewMarketCard(
    grailLike({
      englishName: "Umbreon VMAX",
      stage: "VMAX",
      dexIds: [197],
      setPrintedTotal: 203,
      setTotal: 237,
    }),
  );

  assert.equal(deriveIdentityStatus(sanitized), "verified");
});
