import assert from "node:assert/strict";
import test from "node:test";

import { instantIdentitySearchResponse } from "../src/lib/pokemon-tcg-api";

test("instant Japanese set browse returns Alter Genesis / SM12 without live catalogs", async () => {
  const response = await instantIdentitySearchResponse("", "SM12", 1, "ja", "number-asc");

  assert.ok(response);
  assert.ok((response.results.length ?? 0) >= 20, `got ${response.results.length}`);
  assert.ok((response.totalCount ?? 0) >= 90);
  assert.ok(response.results.every((result) => result.card.language === "ja"));
  assert.ok(response.results.some((result) => result.card.setCode === "SM12"));
});

test("instant Japanese Dialga name search returns official seed tiles", async () => {
  const response = await instantIdentitySearchResponse("dialga", undefined, 1, "ja", "number-asc");

  assert.ok(response);
  assert.ok(response.results.length > 0, "expected Dialga tiles");
  assert.ok(
    response.results.some((result) =>
      /dialga|ディアルガ|アルセウス/i.test(
        `${result.card.name} ${result.card.localizedName ?? ""} ${result.card.englishName ?? ""}`,
      ),
    ),
  );
});

test("instant 017/027 and Dialga 071 resolve from official collector fallbacks", async () => {
  const slash = await instantIdentitySearchResponse("017/027", undefined, 1, "all", "number-asc");
  const partial = await instantIdentitySearchResponse("dialga 071", undefined, 1, "all", "number-asc");

  assert.equal(slash?.results[0]?.card.englishName, "Dialga");
  assert.equal(slash?.results[0]?.card.setCode, "CP2");
  assert.equal(partial?.results[0]?.card.englishName, "Dialga");
  assert.equal(partial?.results[0]?.card.setCode.toUpperCase(), "DPS-B");
  assert.equal(partial?.results[0]?.card.collectorNumber, "71");
});

test("instant Pikachu all-language search returns bundled or Japanese seed tiles", async () => {
  const response = await instantIdentitySearchResponse("pikachu", undefined, 1, "all", "number-asc");

  assert.ok(response);
  assert.ok(response.results.length > 0, "expected Pikachu tiles");
  assert.ok(
    response.results.some((result) =>
      /pikachu|ピカチュウ/i.test(
        `${result.card.name} ${result.card.localizedName ?? ""} ${result.card.englishName ?? ""}`,
      ),
    ),
  );
});
