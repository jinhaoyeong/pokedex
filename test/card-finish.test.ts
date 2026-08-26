import assert from "node:assert/strict";
import test from "node:test";

import {
  applySelectedFinish,
  attachFinishMarketsToCard,
  cardMatchesEditionFilter,
  catalogProviderCardId,
  expandJapaneseEditionSearchCards,
  expandSearchResponseEditions,
  expandSearchResultEditions,
  extractFinishMarketsFromPriceMap,
  filterSalesForFinish,
  filterSearchResultsByEdition,
  inferPrimaryFinish,
  productUrlMatchesFinish,
  saleMatchesFinish,
  selectFinishMarketUsd,
  setHasFirstEditionPrints,
  splitEditionCardId,
  splitOfficialJapaneseCardSlugId,
  standardFinishesForRarity,
  withPriceChartingFinishSuffixes,
} from "../src/lib/card-finish";
import { parseCardEditionFilter } from "../src/lib/search-constants";
import { buildSetSearchHref } from "../src/lib/set-search-href";
import type { SaleRecord, SearchResult, TcgCard } from "../src/types/pokemon";

test("catalog price buckets become distinct non-holo, holo, and reverse markets", () => {
  const markets = extractFinishMarketsFromPriceMap({
    normal: { market: 0.73 },
    holofoil: { market: 4.2 },
    reverseHolofoil: { market: 198 },
  });

  assert.deepEqual(
    markets.map((market) => [market.id, market.ungradedUsd]),
    [
      ["normal", 0.73],
      ["holofoil", 4.2],
      ["reverseHolofoil", 198],
    ],
  );
});

test("commons default to non-holo while rare holos default to holofoil", () => {
  assert.equal(inferPrimaryFinish("Common", ["normal", "reverseHolofoil"]), "normal");
  assert.equal(inferPrimaryFinish("Rare Holo", ["holofoil", "reverseHolofoil"]), "holofoil");
  assert.equal(inferPrimaryFinish("Common", []), "normal");
});

test("missing catalog buckets still expose the finishes collectors actually trade", () => {
  assert.deepEqual(standardFinishesForRarity("Common"), ["normal", "reverseHolofoil"]);
  assert.deepEqual(standardFinishesForRarity("Rare Holo"), ["holofoil", "reverseHolofoil"]);
  assert.deepEqual(standardFinishesForRarity("Promo"), ["holofoil"]);
  assert.deepEqual(standardFinishesForRarity("Unknown", "Charizard ex"), ["holofoil"]);
});

test("sold titles are kept on the matching finish only", () => {
  const reverse: SaleRecord = {
    date: "2026-08-14",
    title: "Machop 51/108 Reverse Holo XY Evolutions",
    condition: "Ungraded",
    price: 12,
    source: "PriceCharting completed eBay sales",
  };
  const raw: SaleRecord = {
    date: "2026-08-14",
    title: "Machop 51/108 XY Evolutions",
    condition: "Ungraded",
    price: 1,
    source: "PriceCharting completed eBay sales",
  };

  assert.equal(saleMatchesFinish(reverse, "reverseHolofoil"), true);
  assert.equal(saleMatchesFinish(raw, "reverseHolofoil"), false);
  assert.equal(saleMatchesFinish(raw, "normal"), true);
  assert.deepEqual(filterSalesForFinish([reverse, raw], "reverseHolofoil"), [reverse]);
});

test("PriceCharting reverse URLs are not reused for the non-holo print", () => {
  const reverseUrl = "https://www.pricecharting.com/game/pokemon-xy-evolutions/machop-51-reverse-holo";
  const normalUrl = "https://www.pricecharting.com/game/pokemon-xy-evolutions/machop-51";

  assert.equal(productUrlMatchesFinish(reverseUrl, "reverseHolofoil"), true);
  assert.equal(productUrlMatchesFinish(reverseUrl, "normal"), false);
  assert.equal(productUrlMatchesFinish(normalUrl, "normal"), true);
  assert.equal(productUrlMatchesFinish(normalUrl, "reverseHolofoil"), false);
  assert.deepEqual(
    withPriceChartingFinishSuffixes(normalUrl, "reverseHolofoil"),
    [`${normalUrl}-reverse-holo`, `${normalUrl}-reverse`],
  );
});

test("holo PriceCharting URLs try the unsuffixed product before -holo", () => {
  const promoUrl = "https://www.pricecharting.com/pop/item/pokemon-promo/pikachu-swsh020";

  assert.deepEqual(withPriceChartingFinishSuffixes(promoUrl, "holofoil"), [
    promoUrl,
    `${promoUrl}-holo`,
  ]);
});

test("selected reverse finish clears mixed comps so that print can load its own market", () => {
  const card = {
    slug: "xy12-51",
    finish: "normal",
    finishMarkets: [
      { id: "normal", label: "Non-holo", shortLabel: "Non-holo", ungradedUsd: 0.73 },
      { id: "reverseHolofoil", label: "Reverse holo", shortLabel: "Reverse", ungradedUsd: 198 },
    ],
    marketPriceUsd: 0.73,
    gradedPrices: [{ grade: "Ungraded", value: 0.73, populationCount: 0 }],
    recentSales: [{ date: "2026-08-14", title: "Machop", condition: "Ungraded", price: 1, source: "x" }],
    psaPopulation: { status: "ready", totalCertified: 12, grades: [], source: "x", fetchedAt: null },
    priceHistory: [],
  } as unknown as TcgCard;

  const reversed = applySelectedFinish(card, "reverseHolofoil");
  assert.equal(reversed.finish, "reverseHolofoil");
  assert.equal(reversed.marketPriceUsd, 198);
  assert.equal(reversed.recentSales.length, 0);
});

test("set name links browse that set's English card list by collector number", () => {
  assert.equal(
    buildSetSearchHref({ setId: "smp", setCode: "SMP", language: "en" }),
    "/search?set=smp&lang=en&sort=number-asc",
  );
});

test("vintage Japanese holos split unlimited and 1st edition into two Dex tiles", () => {
  assert.deepEqual(splitOfficialJapaneseCardSlugId("official-19223-1st-edition"), {
    officialCardId: "19223",
    finish: "firstEditionHolofoil",
  });

  const card = {
    id: "official-19223",
    slug: "ja--official-19223",
    language: "ja",
    finish: "unlimitedHolofoil",
    finishMarkets: [
      { id: "unlimitedHolofoil", label: "Unlimited holo", shortLabel: "Unlimited", ungradedUsd: 8.77 },
      { id: "firstEditionHolofoil", label: "1st Edition holo", shortLabel: "1st Ed holo", ungradedUsd: 20.86 },
    ],
    marketPriceUsd: 8.77,
    gradedPrices: [{ grade: "Ungraded", value: 8.77, populationCount: 0 }],
    recentSales: [],
    psaPopulation: { status: "ready", totalCertified: 0, grades: [], source: "x", fetchedAt: null },
    priceHistory: [],
  } as unknown as TcgCard;

  const [unlimited, firstEdition] = expandJapaneseEditionSearchCards(card);
  assert.equal(unlimited.finish, "unlimitedHolofoil");
  assert.equal(unlimited.marketPriceUsd, 8.77);
  assert.equal(firstEdition.id, "official-19223-1st-edition");
  assert.equal(firstEdition.slug, "ja--official-19223-1st-edition");
  assert.equal(firstEdition.finish, "firstEditionHolofoil");
  assert.equal(firstEdition.marketPriceUsd, 20.86);
  assert.equal(expandJapaneseEditionSearchCards(unlimited).length, 1);
  assert.equal(expandJapaneseEditionSearchCards(firstEdition).length, 1);
});

test("English vintage holos with TCGPlayer 1st edition prices split into two Dex tiles", () => {
  assert.deepEqual(splitEditionCardId("base1-4-1st-edition"), {
    baseId: "base1-4",
    finish: "firstEditionHolofoil",
  });
  assert.equal(parseCardEditionFilter("1st"), "1st");
  assert.equal(parseCardEditionFilter("unlimited"), "unlimited");
  assert.equal(parseCardEditionFilter("nope"), "all");

  const markets = extractFinishMarketsFromPriceMap({
    holofoil: { market: 399 },
    "1stEditionHolofoil": { market: 4200 },
    reverseHolofoil: { market: 12 },
  });
  const card = {
    id: "base1-4",
    slug: "base1-4",
    language: "en",
    finish: "holofoil",
    finishMarkets: markets,
    marketPriceUsd: 399,
    gradedPrices: [{ grade: "Ungraded", value: 399, populationCount: 0 }],
    recentSales: [],
    psaPopulation: { status: "ready", totalCertified: 0, grades: [], source: "x", fetchedAt: null },
    priceHistory: [],
  } as unknown as TcgCard;

  const [unlimited, firstEdition] = expandJapaneseEditionSearchCards(card);
  assert.equal(unlimited.id, "base1-4");
  assert.equal(unlimited.finish, "holofoil");
  assert.equal(unlimited.marketPriceUsd, 399);
  assert.equal(
    unlimited.finishMarkets?.some((market) => market.id === "reverseHolofoil"),
    true,
  );
  assert.equal(
    unlimited.finishMarkets?.some((market) => market.id === "firstEditionHolofoil"),
    false,
  );
  assert.equal(firstEdition.id, "base1-4-1st-edition");
  assert.equal(firstEdition.slug, "base1-4-1st-edition");
  assert.equal(firstEdition.finish, "firstEditionHolofoil");
  assert.equal(firstEdition.marketPriceUsd, 4200);

  const results: SearchResult[] = expandSearchResultEditions([
    { card, score: 10, matchReason: "exact" },
  ]);
  assert.equal(results.length, 2);
  assert.deepEqual(
    filterSearchResultsByEdition(results, "1st").map((result) => result.card.id),
    ["base1-4-1st-edition"],
  );
  assert.deepEqual(
    filterSearchResultsByEdition(results, "unlimited").map((result) => result.card.id),
    ["base1-4"],
  );
  assert.equal(cardMatchesEditionFilter(unlimited, "unlimited"), true);
  assert.equal(cardMatchesEditionFilter(firstEdition, "unlimited"), false);
  assert.equal(cardMatchesEditionFilter(unlimited, "1st"), false);
  assert.equal(cardMatchesEditionFilter(firstEdition, "1st"), true);
});

test("modern cards without a 1st edition market stay visible in the unlimited filter", () => {
  const card = {
    id: "sv3pt5-25",
    slug: "sv3pt5-25",
    finish: "holofoil",
    finishMarkets: [
      { id: "holofoil", label: "Holo", shortLabel: "Holo", ungradedUsd: 12 },
      { id: "reverseHolofoil", label: "Reverse holo", shortLabel: "Reverse", ungradedUsd: 3 },
    ],
    marketPriceUsd: 12,
    gradedPrices: [],
    recentSales: [],
    psaPopulation: { status: "ready", totalCertified: 0, grades: [], source: "x", fetchedAt: null },
    priceHistory: [],
  } as unknown as TcgCard;

  const [only] = expandJapaneseEditionSearchCards(card);
  assert.equal(only.id, "sv3pt5-25");
  assert.equal(cardMatchesEditionFilter(only, "unlimited"), true);
  assert.equal(cardMatchesEditionFilter(only, "1st"), false);
});

test("WOTC Base Set holos still split when TCGPlayer only lists a holofoil bucket", () => {
  assert.equal(setHasFirstEditionPrints({ setId: "base1", setName: "Base" }), true);
  assert.equal(setHasFirstEditionPrints({ setId: "base4", setName: "Base Set 2" }), false);
  assert.equal(setHasFirstEditionPrints({ setId: "sv3pt5", setName: "151" }), false);

  const attached = attachFinishMarketsToCard(
    {
      id: "base1-4",
      slug: "base1-4",
      setId: "base1",
      setName: "Base",
      name: "Charizard",
      rarity: "Rare Holo",
      marketPriceUsd: 859.79,
      gradedPrices: [],
      recentSales: [],
      psaPopulation: { status: "ready", totalCertified: 0, grades: [], source: "x", fetchedAt: null },
      priceHistory: [],
    } as unknown as TcgCard,
    { priceMap: { holofoil: { market: 859.79 } } },
  );

  assert.deepEqual(
    attached.finishMarkets?.map((market) => market.id),
    ["holofoil", "firstEditionHolofoil"],
  );

  const [unlimited, firstEdition] = expandJapaneseEditionSearchCards(attached);
  assert.equal(unlimited.id, "base1-4");
  assert.equal(unlimited.finish, "holofoil");
  assert.equal(firstEdition.id, "base1-4-1st-edition");
  assert.equal(firstEdition.finish, "firstEditionHolofoil");
  assert.equal(firstEdition.marketPriceUsd, 0);
  assert.notEqual(firstEdition.marketPriceUsd, unlimited.marketPriceUsd);

  const baseSet2 = attachFinishMarketsToCard(
    {
      id: "base4-4",
      slug: "base4-4",
      setId: "base4",
      setName: "Base Set 2",
      name: "Charizard",
      rarity: "Rare Holo",
      marketPriceUsd: 479,
      gradedPrices: [],
      recentSales: [],
      psaPopulation: { status: "ready", totalCertified: 0, grades: [], source: "x", fetchedAt: null },
      priceHistory: [],
    } as unknown as TcgCard,
    { priceMap: { holofoil: { market: 479 } } },
  );
  assert.equal(
    baseSet2.finishMarkets?.some((market) => market.id === "firstEditionHolofoil"),
    false,
  );
  assert.equal(expandJapaneseEditionSearchCards(baseSet2).length, 1);
});

test("cached WOTC search rows without a 1st edition market still expand into filterable tiles", () => {
  const response = expandSearchResponseEditions({
    results: [
      {
        card: {
          id: "base1-4",
          slug: "base1-4",
          setId: "base1",
          setName: "Base",
          name: "Charizard",
          rarity: "Rare Holo",
          finish: "holofoil",
          finishMarkets: [
            { id: "holofoil", label: "Holo", shortLabel: "Holo", ungradedUsd: 859.79 },
          ],
          marketPriceUsd: 859.79,
          gradedPrices: [],
          recentSales: [],
          psaPopulation: { status: "ready", totalCertified: 0, grades: [], source: "x", fetchedAt: null },
          priceHistory: [],
        } as unknown as TcgCard,
        score: 10,
        matchReason: "cached",
      },
    ],
    totalCount: 1,
    page: 1,
    pageSize: 24,
    hasNextPage: false,
  });

  assert.deepEqual(
    response.results.map((result) => [result.card.id, result.card.finish]),
    [
      ["base1-4", "holofoil"],
      ["base1-4-1st-edition", "firstEditionHolofoil"],
    ],
  );
  assert.equal(response.totalCount, 2);
  assert.equal(response.results[0].card.marketPriceUsd, 859.79);
  assert.equal(response.results[1].card.marketPriceUsd, 0);
});

test("1st edition tiles never inherit the unlimited holo headline", () => {
  const card = {
    id: "base1-4",
    slug: "base1-4",
    setId: "base1",
    setName: "Base",
    name: "Charizard",
    rarity: "Rare Holo",
    finish: "holofoil",
    finishMarkets: [
      { id: "holofoil", label: "Holo", shortLabel: "Holo", ungradedUsd: 3362 },
      { id: "firstEditionHolofoil", label: "1st Edition holo", shortLabel: "1st Ed holo", ungradedUsd: 0 },
    ],
    marketPriceUsd: 3362,
    gradedPrices: [{ grade: "Ungraded", value: 3362, populationCount: 0 }],
    recentSales: [],
    psaPopulation: { status: "ready", totalCertified: 0, grades: [], source: "x", fetchedAt: null },
    priceHistory: [],
  } as unknown as TcgCard;

  const switched = applySelectedFinish(card, "firstEditionHolofoil");
  assert.equal(switched.marketPriceUsd, 0);
  assert.equal(
    switched.gradedPrices.find((price) => price.grade === "Ungraded")?.value,
    0,
  );

  const [unlimited, firstEdition] = expandJapaneseEditionSearchCards(card);
  assert.equal(unlimited.marketPriceUsd, 3362);
  assert.equal(firstEdition.marketPriceUsd, 0);
  assert.notEqual(firstEdition.marketPriceUsd, unlimited.marketPriceUsd);
  assert.equal(firstEdition.priceConsensus?.finalEstimateUsd, undefined);
});

test("1st edition tiles keep their own finish price instead of the unlimited consensus", () => {
  const card = {
    id: "base1-4",
    slug: "base1-4",
    setId: "base1",
    setName: "Base",
    name: "Charizard",
    rarity: "Rare Holo",
    finish: "holofoil",
    finishMarkets: [
      { id: "holofoil", label: "Holo", shortLabel: "Holo", ungradedUsd: 855 },
      { id: "firstEditionHolofoil", label: "1st Edition holo", shortLabel: "1st Ed holo", ungradedUsd: 6500 },
    ],
    marketPriceUsd: 855,
    gradedPrices: [{ grade: "Ungraded", value: 855, populationCount: 0 }],
    recentSales: [],
    psaPopulation: { status: "ready", totalCertified: 0, grades: [], source: "x", fetchedAt: null },
    priceHistory: [],
    priceConsensus: {
      finalEstimateUsd: 855,
      confidence: "medium",
      confidenceScore: 0.62,
      sourceCount: 1,
      sampleCount: 0,
      methodology: "Unlimited set guide",
      sources: [],
    },
  } as unknown as TcgCard;

  const [unlimited, firstEdition] = expandJapaneseEditionSearchCards(card);
  assert.equal(unlimited.marketPriceUsd, 855);
  assert.equal(firstEdition.marketPriceUsd, 6500);
  assert.equal(firstEdition.priceConsensus?.finalEstimateUsd, 6500);
  assert.notEqual(firstEdition.marketPriceUsd, unlimited.marketPriceUsd);
});

test("switching to 1st edition drops unlimited PSA grades from the shared card", () => {
  const card = {
    id: "base1-4",
    slug: "base1-4",
    setId: "base1",
    setName: "Base",
    name: "Charizard",
    rarity: "Rare Holo",
    finish: "holofoil",
    finishMarkets: [
      { id: "holofoil", label: "Holo", shortLabel: "Holo", ungradedUsd: 855 },
      { id: "firstEditionHolofoil", label: "1st Edition holo", shortLabel: "1st Ed holo", ungradedUsd: 6500 },
    ],
    marketPriceUsd: 855,
    gradedPrices: [
      { grade: "Ungraded", value: 855, populationCount: 0 },
      { grade: "PSA 9", value: 1200, populationCount: 0 },
      { grade: "PSA 10", value: 8000, populationCount: 0 },
    ],
    recentSales: [],
    psaPopulation: { status: "ready", totalCertified: 0, grades: [], source: "x", fetchedAt: null },
    priceHistory: [],
  } as unknown as TcgCard;

  const switched = applySelectedFinish(card, "firstEditionHolofoil");
  assert.equal(switched.marketPriceUsd, 6500);
  assert.equal(switched.gradedPrices.find((price) => price.grade === "Ungraded")?.value, 6500);
  assert.equal(switched.gradedPrices.some((price) => price.grade === "PSA 10"), false);

  const [unlimitedCard, firstEditionCard] = expandJapaneseEditionSearchCards(card);
  assert.equal(
    unlimitedCard.gradedPrices.some((price) => price.grade === "PSA 10"),
    false,
  );
  assert.equal(
    firstEditionCard.gradedPrices.some((price) => price.grade === "PSA 10"),
    false,
  );
});

test("TCGPlayer finish selection keeps holofoil and 1st edition on separate markets", () => {
  const priceMap = {
    holofoil: { market: 399 },
    "1stEditionHolofoil": { market: 4200 },
    reverseHolofoil: { market: 12 },
  };

  assert.equal(selectFinishMarketUsd(priceMap, "holofoil"), 399);
  assert.equal(selectFinishMarketUsd(priceMap, "unlimitedHolofoil"), 399);
  assert.equal(selectFinishMarketUsd(priceMap, "firstEditionHolofoil"), 4200);
  assert.equal(selectFinishMarketUsd(priceMap, "reverseHolofoil"), 12);
  assert.equal(selectFinishMarketUsd(priceMap, null), 399);
});

test("catalogProviderCardId strips edition suffixes", () => {
  assert.equal(catalogProviderCardId("base1-4-1st-edition"), "base1-4");
  assert.equal(catalogProviderCardId("base1-4"), "base1-4");
});
