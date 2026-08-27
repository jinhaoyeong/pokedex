import assert from "node:assert/strict";
import test from "node:test";

import { getPriceChartingSetSlugVariants } from "../src/lib/localized-set-market";
import { numberSlugVariantsForExternalApis } from "../src/lib/psa-population";

test("SWSH Black Star Promos lead with the PriceCharting promo console", () => {
  const slugs = getPriceChartingSetSlugVariants("SWSH Black Star Promos", {
    setCode: "SWSHP",
    language: "en",
  });

  assert.equal(slugs[0], "pokemon-promo");
  assert.ok(slugs.includes("pokemon-swsh-promo"));
});

test("EX Deoxys leads with the PriceCharting deoxys console, not pokemon-ex-deoxys", () => {
  const slugs = getPriceChartingSetSlugVariants("EX Deoxys", {
    setCode: "DX",
    language: "en",
  });

  assert.equal(slugs[0], "pokemon-deoxys");
  assert.ok(slugs.includes("pokemon-team-rocket-returns") === false);
});

test("EX Team Rocket Returns drops the EX prefix for PriceCharting", () => {
  const slugs = getPriceChartingSetSlugVariants("EX Team Rocket Returns", {
    setCode: "TRR",
    language: "en",
  });

  assert.equal(slugs[0], "pokemon-team-rocket-returns");
});

test("promo collector slugs lead with the padded PriceCharting token", () => {
  assert.equal(numberSlugVariantsForExternalApis("SWSH020")[0], "swsh020");
  assert.equal(numberSlugVariantsForExternalApis("SWSH23")[0], "swsh023");
  assert.equal(numberSlugVariantsForExternalApis("SWSH023")[0], "swsh023");
  assert.ok(numberSlugVariantsForExternalApis("SWSH23").includes("swsh23"));
});
