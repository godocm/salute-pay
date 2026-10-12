import test from "node:test";
import assert from "node:assert/strict";
import { fundingStatus, fundingProgress, cumulativeReceived } from "../lib/payment-status.ts";
import { planAllowsNetwork } from "../lib/plans.ts";

test("invoice funding distinguishes partial, exact, excess and cumulative late deposits", () => {
  assert.equal(fundingStatus("0", "100"), "awaiting");
  assert.deepEqual(fundingProgress("10", "100"), {
    status: "partially_paid",
    remaining: 90n,
    excess: 0n,
  });
  assert.equal(fundingStatus("100", "100"), "paid");
  assert.deepEqual(fundingProgress("500", "100"), {
    status: "overpaid",
    remaining: 0n,
    excess: 400n,
  });
  assert.equal(fundingStatus("501", "100"), "overpaid");
  const large = 2n ** 200n;
  assert.equal(fundingProgress(large + 1n, large).excess, 1n);
});
test("dashboard tiers allow all six EVM rails at Growth and require Scale for Solana/TRON", () => {
  for (const chain of ["ethereum", "base", "arbitrum"])
    assert.equal(planAllowsNetwork("free", chain), true);
  for (const chain of ["tempo", "bnb", "robinhood"]) {
    assert.equal(planAllowsNetwork("free", chain), false);
    assert.equal(planAllowsNetwork("growth", chain), true);
  }
  for (const chain of ["solana", "tron"]) {
    assert.equal(planAllowsNetwork("growth", chain), false);
    assert.equal(planAllowsNetwork("scale", chain), true);
  }
  assert.equal(planAllowsNetwork("scale", "unknown"), false);
});


test("offline balance and cached sweeps cannot masquerade as cumulative receipt history", () => {
  assert.equal(cumulativeReceived({ balance: "10", collected: "500" }), 10n);
  assert.equal(cumulativeReceived({ balance: "0", collected: "100" }), 0n);
  assert.equal(cumulativeReceived({ balance: "10", collected: "500", received: "100" }), 100n);
  assert.equal(fundingStatus(cumulativeReceived({ balance: "0", collected: "100" }), "100"), "awaiting");
});
