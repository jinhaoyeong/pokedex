import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveTcgdexApiLanguage,
  tcgdexApiLanguageFallbacks,
} from "../src/lib/pokemon-tcg/tcgdex-normalizers";
import { localizedNameSearchVariants } from "../src/lib/pokemon-tcg/text-and-collector-utils";

test("Simplified Chinese catalog requests stay on zh-cn, not Traditional zh-tw", () => {
  assert.equal(resolveTcgdexApiLanguage("zh-cn"), "zh-cn");
  assert.equal(resolveTcgdexApiLanguage("zh-tw"), "zh-tw");
  assert.deepEqual(tcgdexApiLanguageFallbacks("zh-cn"), ["zh-cn", "zh-tw"]);
  assert.deepEqual(tcgdexApiLanguageFallbacks("zh-tw"), ["zh-tw"]);
});

test("Portuguese TCGdex language still maps to pt-br", () => {
  assert.equal(resolveTcgdexApiLanguage("pt"), "pt-br");
});

test("Chinese name aliases keep GX/ex suffixes for catalog search", () => {
  const variants = localizedNameSearchVariants(["喷火龙"], "charizard", "zh-cn");
  assert.ok(variants.includes("喷火龙"));
  assert.ok(variants.includes("喷火龙GX"));
  assert.ok(variants.includes("喷火龙ex"));
});
