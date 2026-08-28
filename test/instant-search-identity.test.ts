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

test("instant set browse resolves Alter Genesis and オルタージェネシス to SM12", async () => {
  const byEnglish = await instantIdentitySearchResponse("", "Alter Genesis", 1, "ja", "number-asc");
  const byJapanese = await instantIdentitySearchResponse(
    "",
    "オルタージェネシス",
    1,
    "ja",
    "number-asc",
  );

  assert.ok(byEnglish?.results.some((result) => result.card.setCode === "SM12"));
  assert.ok(byJapanese?.results.some((result) => result.card.setCode === "SM12"));
  assert.ok((byEnglish?.totalCount ?? 0) >= 90);
  assert.ok((byJapanese?.totalCount ?? 0) >= 90);
});

test("instant SM12 browse keeps the known TAG TEAM GX print number", async () => {
  const response = await instantIdentitySearchResponse("", "SM12", 1, "ja", "relevance");

  assert.ok(response);
  const cards = [];
  for (let page = 1; page <= 8; page += 1) {
    const pageResponse =
      page === 1
        ? response
        : await instantIdentitySearchResponse("", "SM12", page, "ja", "relevance");
    cards.push(...(pageResponse?.results.map((result) => result.card) ?? []));
    if (pageResponse && !pageResponse.hasNextPage) {
      break;
    }
  }

  const trio = cards.find(
    (card) => card.officialCardId === "37382" || card.slug === "ja--official-37382",
  );
  assert.ok(trio, "expected official card 37382 in SM12 seed");
  assert.equal(trio?.collectorNumber, "100");
  assert.equal(trio?.marketIdentity?.identityStatus, "confirmed");
  assert.equal(trio?.setEnglishName, "Alter Genesis");
});
