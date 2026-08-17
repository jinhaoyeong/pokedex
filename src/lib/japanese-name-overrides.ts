export const JAPANESE_CARD_NAME_OVERRIDES: Record<string, string> = {
  "なみのりピカチュウV": "Surfing Pikachu V",
  "なみのりピカチュウVMAX": "Surfing Pikachu VMAX",
  "そらをとぶピカチュウV": "Flying Pikachu V",
  "そらをとぶピカチュウVMAX": "Flying Pikachu VMAX",
  "ピカチュウV-UNION": "Pikachu V-UNION",
  "オリジンパルキアV": "Origin Forme Palkia V",
  "オリジンパルキアVSTAR": "Origin Forme Palkia VSTAR",
  "博士の研究": "Professor's Research",
  "ボスの指令": "Boss's Orders",
  "基本草エネルギー": "Grass Energy [Holo]",
  "基本炎エネルギー": "Fire Energy [Holo]",
  "基本水エネルギー": "Water Energy [Holo]",
  "基本雷エネルギー": "Lightning Energy [Holo]",
  "基本超エネルギー": "Psychic Energy [Holo]",
  "基本闘エネルギー": "Fighting Energy [Holo]",
  "基本悪エネルギー": "Darkness Energy [Holo]",
  "基本鋼エネルギー": "Metal Energy [Holo]",
  "エネルギー転送": "Energy Switch",
  "ふしぎなアメ": "Rare Candy",
  "ポケモンいれかえ": "Switch",
  "ポケモンキャッチャー": "Pokemon Catcher",
  "ハイパーボール": "Ultra Ball",
  "ネストボール": "Nest Ball",
  "スーパーボール": "Great Ball",
  "モンスターボール": "Poke Ball",
  // Supplement-set Mega forms (M5 Abyss Eye, M2A MEGA Dream ex, M4 Ninja Spinner).
  // These are supplement-set-only cards whose base names aren't in the species DB.
  "メガゼラオラ": "Mega Zeraora",
  "メガシャンデラ": "Mega Chandelure",
  "メガダークライ": "Mega Darkrai",
  "メガドリュウズ": "Mega Excadrill",
  "メガユキメノコ": "Mega Froslass",
  "メガシビルドン": "Mega Eelektross",
  "メガサーナイト": "Mega Gardevoir",
  "メガルカリオ": "Mega Lucario",
  "メガルチャブル": "Mega Hawlucha",
  "メガゲンガー": "Mega Gengar",
  "メガズルズキン": "Mega Scrafty",
  "メガカイリュー": "Mega Dragonite",
  "メガリザードンX": "Mega Charizard X",
  "メガディアンシー": "Mega Diancie",
  "メガカエンジシ": "Mega Pyroar",
  "メガゲッコウガ": "Mega Greninja",
  "メガフラエッテ": "Mega Floette",
  "メガドラミドロ": "Mega Dragalge",
  // M4 Ninja Spinner trainer — PriceCharting files this as "Tranquility", not "Serenity".
  "AZの安らぎ": "AZ's Tranquility",
};

export function parseJapaneseCardNameSuffix(jpName: string): { base: string; englishSuffix: string } {
  const trimmed = jpName.trim();
  const rules: Array<[RegExp, string]> = [
    [/^(.+?)V-UNION$/u, " V-UNION"],
    [/^(.+?)VMAX$/u, " VMAX"],
    [/^(.+?)VSTAR$/u, " VSTAR"],
    [/^(.+?)ex$/u, " ex"],
    [/^(.+?)EX$/u, " EX"],
    [/^(.+?)GX$/u, " GX"],
    [/^(.+?)V$/u, " V"],
    [/^(.+?)δ$/u, " Delta"],
  ];

  for (const [pattern, englishSuffix] of rules) {
    const match = trimmed.match(pattern);

    if (match?.[1]) {
      return { base: match[1].trim(), englishSuffix };
    }
  }

  return { base: trimmed, englishSuffix: "" };
}

export function parseJapaneseCardNameAffixes(jpName: string): {
  base: string;
  englishPrefix: string;
  englishSuffix: string;
} {
  const { base, englishSuffix } = parseJapaneseCardNameSuffix(jpName);

  if (/^わるい/.test(base)) {
    return { base: base.replace(/^わるい/u, "").trim(), englishPrefix: "Dark ", englishSuffix };
  }

  if (/^やさしい/.test(base)) {
    return { base: base.replace(/^やさしい/u, "").trim(), englishPrefix: "Light ", englishSuffix };
  }

  return { base, englishPrefix: "", englishSuffix };
}
