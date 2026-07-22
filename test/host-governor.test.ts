import assert from "node:assert/strict";
import test from "node:test";

import {
  getHostCircuitSnapshot,
  isHostCircuitOpen,
  recordHostFailure,
  recordHostSuccess,
  runGovernedHostRequest,
} from "../src/lib/market/host-governor";

test("host circuit opens at threshold, survives stale success, and recovers after cooldown", async () => {
  const host = "deterministic-circuit.test";
  const realNow = Date.now;
  let now = Date.parse("2026-07-22T00:00:00.000Z");
  Date.now = () => now;

  try {
    recordHostFailure(host, { threshold: 2, cooldownMs: 1_000 });
    assert.equal(isHostCircuitOpen(host), false);

    recordHostFailure(host, { threshold: 2, cooldownMs: 1_000 });
    assert.equal(isHostCircuitOpen(host), true);
    assert.deepEqual(getHostCircuitSnapshot(host), {
      host,
      failures: 2,
      open: true,
      openUntil: "2026-07-22T00:00:01.000Z",
      remainingCooldownMs: 1_000,
    });

    recordHostSuccess(host);
    assert.equal(isHostCircuitOpen(host), true);

    now += 1_001;
    assert.equal(isHostCircuitOpen(host), false);

    let taskRuns = 0;
    const result = await runGovernedHostRequest(
      host,
      { minIntervalMs: 0 },
      async () => {
        taskRuns += 1;
        return "recovered";
      },
    );
    recordHostSuccess(host);

    assert.equal(result, "recovered");
    assert.equal(taskRuns, 1);
    assert.equal(getHostCircuitSnapshot(host).open, false);
  } finally {
    Date.now = realNow;
  }
});
