import assert from "node:assert/strict";
import test from "node:test";

import {
  consensusCanReplaceCatalogMarket,
  getHeadlineMarketPriceUsd,
} from "../src/lib/localized-set-market";

test("thin two-source blends cannot replace a much higher finish guide", () => {
  assert.equal(consensusCanReplaceCatalogMarket(6500, 425), false);
  assert.equal(consensusCanReplaceCatalogMarket(6500, 3250), true);
  assert.equal(consensusCanReplaceCatalogMarket(0, 425), true);

  assert.equal(
    getHeadlineMarketPriceUsd({
      marketPriceUsd: 6500,
      language: "en",
      priceConsensus: {
        finalEstimateUsd: 425,
        confidenceScore: 0.95,
        methodology: "Blended Magery sold comps",
        sources: [
          { source: "Magery", confidenceScore: 0.9, evidenceType: "sold_comp" },
          { source: "TCGFish", confidenceScore: 0.8, evidenceType: "sold_comp" },
        ],
      },
    }),
    6500,
  );
});

test("sold-comp consensus still wins when it is close to the catalog finish price", () => {
  assert.equal(
    getHeadlineMarketPriceUsd({
      marketPriceUsd: 6500,
      language: "en",
      priceConsensus: {
        finalEstimateUsd: 6120,
        confidenceScore: 0.9,
        methodology: "1st Edition sold comps",
        sources: [
          { source: "Magery", confidenceScore: 0.9, evidenceType: "sold_comp" },
        ],
      },
    }),
    6120,
  );
});
