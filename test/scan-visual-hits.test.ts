import assert from "node:assert/strict";
import test from "node:test";

import {
  isDecisiveVisualResult,
  mergeSearchResults,
  mergeVisualHits,
} from "../src/lib/scan/visual-hits";
import type { VisualIndexHit } from "../src/lib/scan/types";
import type { SearchResult, TcgCard } from "../src/types/pokemon";

function hit(
  id: string,
  name: string,
  score: number,
  extra: Partial<VisualIndexHit> = {},
): VisualIndexHit {
  return {
    id,
    name,
    setName: "",
    localId: extra.localId ?? "",
    lang: extra.lang ?? "en",
    image: "",
    score,
  };
}

test("mergeVisualHits keeps the best score per card id", () => {
  const merged = mergeVisualHits(
    [
      [hit("swsh7-215", "Umbreon VMAX", 0.9), hit("swsh7-26", "Tentacool", 0.81)],
      [hit("swsh7-215", "Umbreon VMAX", 0.84), hit("base5-4", "Dark Charizard", 0.88)],
    ],
    8,
  );

  assert.equal(merged[0]?.id, "swsh7-215");
  assert.equal(merged[0]?.score, 0.9);
  assert.equal(merged.find((row) => row.id === "base5-4")?.score, 0.88);
});

test("a clean Umbreon hash beat is decisive against Tentacool collisions", () => {
  assert.equal(
    isDecisiveVisualResult(
      [
        hit("swsh7-215", "Umbreon VMAX", 0.90625),
        hit("swsh7-26", "Tentacool", 0.8125),
      ],
      0.78,
    ),
    true,
  );
});

test("same-name reprints stay decisive so OCR is not required", () => {
  assert.equal(
    isDecisiveVisualResult(
      [
        hit("swsh7-215", "Umbreon VMAX", 0.91, { localId: "215" }),
        hit("s10a-84", "Umbreon VMAX", 0.9, { localId: "84", lang: "ja" }),
      ],
      0.78,
    ),
    true,
  );
});

test("close scores for different Pokemon are not decisive", () => {
  assert.equal(
    isDecisiveVisualResult(
      [
        hit("base5-4", "Dark Charizard", 0.8),
        hit("sv3-125", "Charizard ex", 0.79),
      ],
      0.78,
    ),
    false,
  );
});

test("mergeSearchResults keeps the higher visual score per slug", () => {
  const card = (slug: string, id: string): TcgCard =>
    ({ slug, id, name: slug, language: "en" }) as TcgCard;
  const merged = mergeSearchResults([
    [{ card: card("swsh7-215", "swsh7-215"), score: 0.7, matchReason: "hash" }],
    [{ card: card("swsh7-215", "swsh7-215"), score: 0.9, matchReason: "clip" }],
  ]);
  assert.equal(merged[0]?.score, 0.9);
});
