const cases = [
  {
    id: "aquapolis-lugia",
    params: {
      setName: "Aquapolis",
      cardName: "Lugia",
      cardNumber: "149",
      setCode: "ECARD2",
      language: "en",
      rarity: "Rare Secret",
      rawMarketPriceUsd: "852",
      setTotal: "147",
    },
  },
  {
    id: "celebrations-classic-charizard",
    params: {
      setName: "Celebrations: Classic Collection",
      cardName: "Charizard",
      cardNumber: "4",
      setCode: "CEL25C",
      language: "en",
      rarity: "Classic Collection",
      rawMarketPriceUsd: "208",
    },
  },
  {
    id: "sv2a-mew-ex-ja",
    params: {
      setName: "Pokemon Card 151",
      cardName: "Mew ex",
      cardNumber: "205",
      setCode: "SV2A",
      language: "ja",
      englishCardName: "Mew ex",
      rawMarketPriceUsd: "398",
    },
  },
];

const baseUrl = "http://localhost:3000";

for (const testCase of cases) {
  for (const mode of ["core", "full"]) {
    const url = new URL("/api/grading-market", baseUrl);
    const search = new URLSearchParams(testCase.params);
    search.set("mode", mode);
    search.set("_", String(Date.now()));
    url.search = search.toString();

    const response = await fetch(url);
    const payload = await response.json();
    const sourceStates = (payload.sourceStatus ?? payload.evidenceSummary?.sourceStatus ?? []).map(
      (status) => `${status.source}:${status.state}`,
    );

    console.log(
      JSON.stringify({
        id: testCase.id,
        mode,
        ok: response.ok,
        grades: payload.psaPopulation?.grades?.length ?? 0,
        gradedPrices: payload.gradedPrices?.length ?? 0,
        recentSales: payload.recentSales?.length ?? 0,
        states: sourceStates,
      }),
    );
  }
}
