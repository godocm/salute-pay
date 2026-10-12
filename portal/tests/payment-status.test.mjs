import test from "node:test";
import assert from "node:assert/strict";
import { fundingStatus, fundingProgress, cumulativeReceived, fundingView } from "../lib/payment-status.ts";
import { isBetaNetwork, planAllowsNetwork, planPaymentLimit } from "../lib/plans.ts";

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
test("testnet beta opens all eight networks and removes quotas without changing production plans", () => {
  const ids = { ethereum: "11155111", base: "84532", arbitrum: "421614", tempo: "42431", bnb: "97", robinhood: "46630", solana: "devnet", tron: "3448148188" };
  for (const [chain, chainId] of Object.entries(ids)) {
    const beta = isBetaNetwork({ chain, chainId, environment: "testnet" });
    assert.equal(beta, true);
    assert.equal(planAllowsNetwork("free", chain, beta), true);
  }
  assert.equal(planPaymentLimit("free", true), Infinity);
  assert.equal(planPaymentLimit("growth", true), Infinity);
  assert.equal(planPaymentLimit("free"), 20);
  assert.equal(planPaymentLimit("growth"), 1000);
  assert.equal(isBetaNetwork({ chain: "ethereum", chainId: "1", environment: "testnet" }), false);
  assert.equal(isBetaNetwork({ chain: "tempo", chainId: "42431", environment: "mainnet" }), false);
  assert.equal(isBetaNetwork({ chain: "tempo", chainId: "42431" }), false);
  assert.equal(planAllowsNetwork("free", "unknown", true), false);
});


test("offline balance and cached sweeps cannot masquerade as cumulative receipt history", () => {
  assert.equal(cumulativeReceived({ balance: "10", collected: "500" }), 10n);
  assert.equal(cumulativeReceived({ balance: "0", collected: "100" }), 0n);
  assert.equal(cumulativeReceived({ balance: "10", collected: "500", received: "100" }), 100n);
  assert.equal(fundingStatus(cumulativeReceived({ balance: "0", collected: "100" }), "100"), "awaiting");
});

test("indexed accounting stays authoritative while the watcher catches up with live balances", () => {
  assert.equal(cumulativeReceived({ balance: "10", received: "0" }), 0n);
  assert.equal(cumulativeReceived({ balance: "90", collected: "10", received: "10" }), 10n);
  assert.equal(cumulativeReceived({ balance: "500", collected: "10", received: "100" }), 100n);
  assert.equal(cumulativeReceived({ balance: "0", collected: "10", received: "510" }), 510n);
});

test("live balance funding is labelled separately while receipt indexing catches up", async () => {
  const { fundingView } = await import("../lib/payment-status.ts");
  assert.equal(fundingView({ balance: "10", received: "0" }, "100").label, "Underpaid balance");
  assert.equal(fundingView({ balance: "100", received: "0" }, "100").status, "paid");
  assert.equal(fundingView({ balance: "500", received: "10" }, "100").label, "Overpaid balance");
  assert.equal(fundingView({ balance: "0", received: "510" }, "100").label, "Overpaid");
  assert.equal(fundingView({ balance: "0" }, "100").label, "No balance");
});

test("queue labels distinguish live balances from indexed invoice completion", () => {
  const live = fundingView({ balance: "100", received: "0" }, "100");
  assert.equal(live.label, "Fully funded balance");
  assert.equal(live.fromBalance, true);
  const indexed = fundingView({ balance: "0", received: "100" }, "100");
  assert.equal(indexed.label, "Fully paid");
  assert.equal(indexed.fromBalance, false);
  assert.equal(fundingView({ balance: "0" }, "100").label, "No balance");
});
