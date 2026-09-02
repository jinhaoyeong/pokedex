import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

function isHobbySafeDailyCron(schedule: string) {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const isSingleNumber = (value: string) => /^\d+$/.test(value);
  return (
    isSingleNumber(minute) &&
    isSingleNumber(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    (dayOfWeek === "*" || isSingleNumber(dayOfWeek))
  );
}

test("warm-search cron is once per day so Hobby Vercel deploys succeed", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  const cron = vercel.crons?.find((entry) => entry.path === "/api/cron/warm-search");
  assert.ok(cron, "expected a warm-search cron in vercel.json");
  assert.equal(cron.schedule, "0 6 * * *");
  assert.ok(
    isHobbySafeDailyCron(cron.schedule),
    `Hobby forbids sub-daily crons, got ${cron.schedule}`,
  );
  assert.equal(isHobbySafeDailyCron("0 */6 * * *"), false);
});
