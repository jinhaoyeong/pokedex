import assert from "node:assert/strict";
import test from "node:test";

import { resolveHydrationSafeSets } from "../src/lib/hydration-safe-sets";

test("pre-hydration render ignores a warm client cache", () => {
  const result = resolveHydrationSafeSets({
    mounted: false,
    clientSets: [{ id: "sv3" }],
    initialSets: [],
    isLoadingSets: false,
  });

  assert.deepEqual(result.sets, []);
  assert.equal(result.isLoadingSets, true);
});

test("post-hydration render uses the client cache", () => {
  const cached = [{ id: "sv3" }];
  const result = resolveHydrationSafeSets({
    mounted: true,
    clientSets: cached,
    initialSets: [],
    isLoadingSets: false,
  });

  assert.equal(result.sets, cached);
  assert.equal(result.isLoadingSets, false);
});

test("pre-hydration render keeps server-provided sets", () => {
  const initial = [{ id: "base1" }];
  const result = resolveHydrationSafeSets({
    mounted: false,
    clientSets: [{ id: "sv3" }],
    initialSets: initial,
    isLoadingSets: false,
  });

  assert.equal(result.sets, initial);
  assert.equal(result.isLoadingSets, false);
});

test("post-hydration render preserves an in-flight loading flag", () => {
  const current = [{ id: "base1" }];
  const result = resolveHydrationSafeSets({
    mounted: true,
    clientSets: current,
    initialSets: [],
    isLoadingSets: true,
  });

  assert.equal(result.sets, current);
  assert.equal(result.isLoadingSets, true);
});
