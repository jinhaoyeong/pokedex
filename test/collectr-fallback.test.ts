import assert from "node:assert/strict";
import test from "node:test";

import { isUsableCollectrCatalogResponse } from "../src/lib/price/collectr-fallback";

test("Collectr HTTP 202 empty HTML is not a catalog match", () => {
  assert.equal(
    isUsableCollectrCatalogResponse(202, "text/html", "<html></html>"),
    false,
  );
  assert.equal(isUsableCollectrCatalogResponse(200, "application/json", ""), false);
  assert.equal(
    isUsableCollectrCatalogResponse(200, "text/html", "<html>blocked</html>"),
    false,
  );
});

test("Collectr JSON catalogs remain usable", () => {
  assert.equal(
    isUsableCollectrCatalogResponse(
      200,
      "application/json; charset=utf-8",
      JSON.stringify({ data: [] }),
    ),
    true,
  );
});
