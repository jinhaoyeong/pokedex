import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WARM_SEARCH_JOBS,
  parseSetBrowseHitKey,
  selectWarmSearchJobs,
  setBrowseHitKey,
  WARM_SEARCH_MAX_JOBS,
} from "../src/lib/warm-search-plan";

test("hit counts rank live Dex browses ahead of the default set list", () => {
  const jobs = selectWarmSearchJobs(
    {
      [setBrowseHitKey("sv3pt5", "en", "price-desc")]: 40,
      [setBrowseHitKey("me2pt5", "all", "price-desc")]: 12,
      "noise|xx|relevance": 99,
    },
    DEFAULT_WARM_SEARCH_JOBS,
    4,
  );

  assert.deepEqual(
    jobs.map((job) => setBrowseHitKey(job.setId, job.language, job.sort)),
    [
      "sv3pt5|en|price-desc",
      "me2pt5|all|price-desc",
      "me2pt5|en|price-desc",
      "me4|all|price-desc",
    ],
  );
});

test("quiet traffic still warms the default chase sets", () => {
  const jobs = selectWarmSearchJobs({}, DEFAULT_WARM_SEARCH_JOBS);
  assert.ok(jobs.length <= WARM_SEARCH_MAX_JOBS);
  assert.equal(jobs[0]?.setId, "me2pt5");
  assert.equal(jobs[0]?.sort, "price-desc");
  assert.equal(parseSetBrowseHitKey("me2pt5|all|price-desc")?.setId, "me2pt5");
  assert.equal(parseSetBrowseHitKey("me2pt5|all|relevance"), null);
});
